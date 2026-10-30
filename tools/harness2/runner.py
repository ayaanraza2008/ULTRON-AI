from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from core import *  # re-exported utility surface is intentionally shared by CLI/tests
from executors import BaseExecutor, make_executor


def judge_answer(answer: str, criteria: dict[str, Any]) -> dict[str, Any]:
    folded = answer.casefold()
    checks = []
    for token in criteria.get("all_contains", []):
        checks.append({"kind": "contains", "value": token, "passed": token.casefold() in folded})
    options = criteria.get("any_contains", [])
    if options:
        checks.append({"kind": "any_contains", "value": options, "passed": any(value.casefold() in folded for value in options)})
    for token in criteria.get("forbidden_contains", []):
        checks.append({"kind": "forbidden_absent", "value": token, "passed": token.casefold() not in folded})
    minimum = criteria.get("min_chars", 0)
    if minimum:
        checks.append({"kind": "min_chars", "value": minimum, "passed": len(answer.strip()) >= minimum})
    if not checks:
        checks.append({"kind": "non_empty", "value": True, "passed": bool(answer.strip())})
    passed = sum(1 for item in checks if item["passed"])
    return {"score": round(passed / len(checks), 6), "passed": passed, "total": len(checks), "checks": checks}


def score_tasks(benchmark: dict[str, Any], answers: list[dict[str, Any]]) -> dict[str, Any]:
    by_id = {item.get("task_id"): item for item in answers}
    results = []
    for task in benchmark["tasks"]:
        row = by_id.get(task["id"], {})
        answer = row.get("answer", "") if isinstance(row.get("answer"), str) else ""
        judged = judge_answer(answer, task.get("criteria", {}))
        results.append({
            "task_id": task["id"], "title": task.get("title", task["id"]),
            "answer": answer[:20_000], "score": judged["score"],
            "passed_checks": judged["passed"], "total_checks": judged["total"],
            "checks": judged["checks"], "executor_error": row.get("executor_error"),
        })
    score = sum(item["score"] for item in results) / len(results)
    return {"score": round(score, 6), "task_count": len(results), "tasks": results}


def run_path(workspace: Path, run_id: str) -> Path:
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise Harness2Error("Invalid run ID")
    workspace = workspace.expanduser().resolve()
    state_root = workspace / ".harness2"
    runs_dir = state_root / "runs"
    if state_root.is_symlink() or runs_dir.is_symlink():
        raise Harness2Error("Harness2 state directories may not be symlinks")
    runs_root = runs_dir.resolve()
    if runs_root != runs_dir:
        raise Harness2Error("Run storage resolves outside the workspace")
    target = runs_root / run_id
    if target.is_symlink():
        raise Harness2Error("Run folders may not be symlinks")
    return target


def candidate_path(run_dir: Path, candidate_id: str) -> Path:
    if candidate_id != "baseline" and not re.fullmatch(r"r[0-9]{2}-c[0-9]{2}", candidate_id):
        raise Harness2Error("Invalid candidate ID")
    root = run_dir / "candidates"
    if run_dir.is_symlink() or root.is_symlink():
        raise Harness2Error("Candidate storage may not be symlinked")
    target = root / candidate_id
    if target.is_symlink():
        raise Harness2Error("Candidate folders may not be symlinks")
    return target


def save_state(run_dir: Path, state: dict[str, Any]) -> None:
    state["updated_at"] = utc_now()
    atomic_json(run_dir / "run.json", state)


def evaluate_candidate(executor: BaseExecutor, benchmark: dict[str, Any], harness_dir: Path,
                       workspace_dir: Path, candidate_id: str, round_no: int,
                       base_candidate: str | None, changed: list[str]) -> dict[str, Any]:
    components = load_components(harness_dir)
    answers = []
    errors = []
    for task in benchmark["tasks"]:
        try:
            response = executor.solve(task, components, workspace_dir)
            answer = response.get("answer")
            if not isinstance(answer, str):
                raise Harness2Error("Executor response is missing answer text")
            answers.append({"task_id": task["id"], "answer": answer[:20_000]})
        except Exception as exc:
            detail = str(exc)[:1200]
            errors.append(f"{task['id']}: {detail}")
            answers.append({"task_id": task["id"], "answer": "", "executor_error": detail})
    judgment = score_tasks(benchmark, answers)
    return {
        "candidate_id": candidate_id, "round": round_no, "base_candidate": base_candidate,
        "status": "completed_with_errors" if errors else "completed",
        "score": judgment["score"], "changed_components": changed,
        "task_results": answers, "judgment": judgment, "errors": errors,
        "completed_at": utc_now(),
    }


def run_candidate(run_dir: Path, candidate_id: str, round_no: int, base_id: str,
                  source_harness: Path, benchmark: dict[str, Any], executor: BaseExecutor,
                  targets: list[str], feedback: list[dict[str, Any]]) -> dict[str, Any]:
    root = candidate_path(run_dir, candidate_id)
    record_path = root / "candidate.json"
    if record_path.is_file():
        saved = read_json(record_path)
        if saved.get("status") in {"completed", "completed_with_errors", "refinement_failed"}:
            return saved
    if root.exists():
        check_tree_for_symlinks(root)
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)
    harness_dir = root / "harness"
    shutil.copytree(source_harness, harness_dir)
    workspace_dir = root / "workspace"
    workspace_dir.mkdir()
    try:
        proposal = executor.refine(load_components(harness_dir), targets, feedback, workspace_dir)
        updates = proposal.get("updates") if isinstance(proposal, dict) else None
        changed = apply_updates(harness_dir, updates, set(targets))
        result = evaluate_candidate(executor, benchmark, harness_dir, workspace_dir,
                                   candidate_id, round_no, base_id, changed)
    except Exception as exc:
        result = {
            "candidate_id": candidate_id, "round": round_no, "base_candidate": base_id,
            "status": "refinement_failed", "score": 0.0, "changed_components": [],
            "task_results": [], "judgment": None, "errors": [str(exc)[:1200]],
            "completed_at": utc_now(),
        }
    atomic_json(record_path, result)
    return result


def best_of(items: list[dict[str, Any]]) -> dict[str, Any]:
    return max(items, key=lambda item: (float(item.get("score", 0)), -int(item.get("round", 0)), item.get("candidate_id", "")))


def create_run(workspace: Path, benchmark_name: str, benchmark: dict[str, Any], args: argparse.Namespace) -> tuple[Path, dict[str, Any]]:
    config = load_workspace_config(workspace)
    source_harness = workspace / config["harness_path"]
    load_components(source_harness)
    run_id = dt.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    directory = run_path(workspace, run_id)
    directory.mkdir(parents=True, exist_ok=False)
    shutil.copytree(source_harness, directory / "baseline-harness")
    atomic_json(directory / "benchmark.json", benchmark)
    state = {
        "schema_version": SCHEMA_VERSION, "tool_version": VERSION,
        "run_id": run_id, "created_at": utc_now(), "updated_at": utc_now(),
        "status": "running", "workspace": str(workspace), "benchmark": benchmark_name,
        "executor": args.executor or config.get("default_executor", "demo"), "model": args.model,
        "mode": args.mode or config.get("default_mode", "sequential"),
        "iterations": args.iterations, "parallelism": args.parallelism, "timeout_seconds": args.timeout,
        "next_round": 1, "rounds_completed": 0, "candidate_ids": [],
        "best_candidate": "baseline", "best_score": 0.0,
    }
    save_state(directory, state)
    return directory, state


def feedback_for(candidate: dict[str, Any]) -> list[dict[str, Any]]:
    judgment = candidate.get("judgment") or {"tasks": []}
    feedback = []
    for task in judgment.get("tasks", []):
        failed = [check for check in task.get("checks", []) if not check.get("passed")]
        if failed:
            feedback.append({"task_id": task["task_id"], "title": task.get("title"), "failed_checks": failed, "score": task.get("score", 0)})
    return feedback


def load_candidate(run_dir: Path, candidate_id: str) -> dict[str, Any]:
    return read_json(candidate_path(run_dir, candidate_id) / "candidate.json")


def refine_run(run_dir: Path, state: dict[str, Any]) -> dict[str, Any]:
    benchmark = read_json(run_dir / "benchmark.json")
    baseline_harness = run_dir / "baseline-harness"
    baseline_root = candidate_path(run_dir, "baseline")
    baseline_file = baseline_root / "candidate.json"
    if not baseline_file.exists():
        if baseline_root.exists():
            check_tree_for_symlinks(baseline_root)
            shutil.rmtree(baseline_root)
        baseline_root.mkdir(parents=True, exist_ok=True)
        shutil.copytree(baseline_harness, baseline_root / "harness")
        work = baseline_root / "workspace"
        work.mkdir()
        baseline = evaluate_candidate(
            make_executor(state["executor"], state.get("model"), int(state["timeout_seconds"])),
            benchmark, baseline_root / "harness", work, "baseline", 0, None, [],
        )
        atomic_json(baseline_file, baseline)
        state["candidate_ids"] = ["baseline"]
        state["best_candidate"] = "baseline"
        state["best_score"] = baseline["score"]
        save_state(run_dir, state)
    candidate_ids = set(state.get("candidate_ids", [])) | {"baseline"}
    best = load_candidate(run_dir, state.get("best_candidate", "baseline"))
    for round_no in range(int(state.get("next_round", 1)), int(state["iterations"]) + 1):
        count = 1 if state["mode"] == "sequential" else min(int(state["parallelism"]), len(COMPONENT_NAMES))
        targets = []
        for index in range(count):
            offset = (round_no - 1) * count + index
            targets.append([COMPONENT_NAMES[offset % len(COMPONENT_NAMES)]])
        base_id = state["best_candidate"]
        source_harness = candidate_path(run_dir, base_id) / "harness"
        feedback = feedback_for(best)
        jobs = [(f"r{round_no:02d}-c{index + 1:02d}", group) for index, group in enumerate(targets)]
        round_results = []
        pending = []
        for candidate_id, group in jobs:
            candidate_file = candidate_path(run_dir, candidate_id) / "candidate.json"
            if candidate_file.is_file():
                saved = read_json(candidate_file)
                if saved.get("status") in {"completed", "completed_with_errors", "refinement_failed"}:
                    round_results.append(saved)
                    candidate_ids.add(candidate_id)
                    continue
            pending.append((candidate_id, group))
        if state["mode"] == "parallel" and len(pending) > 1:
            with concurrent.futures.ThreadPoolExecutor(max_workers=count) as pool:
                futures = {
                    pool.submit(
                        run_candidate, run_dir, candidate_id, round_no, base_id,
                        source_harness, benchmark,
                        make_executor(state["executor"], state.get("model"), int(state["timeout_seconds"])),
                        group, feedback,
                    ): candidate_id for candidate_id, group in pending
                }
                for future in concurrent.futures.as_completed(futures):
                    result = future.result()
                    round_results.append(result)
                    candidate_ids.add(result["candidate_id"])
                    state["candidate_ids"] = sorted(candidate_ids)
                    save_state(run_dir, state)
        else:
            for candidate_id, group in pending:
                result = run_candidate(
                    run_dir, candidate_id, round_no, base_id, source_harness,
                    benchmark, make_executor(state["executor"], state.get("model"), int(state["timeout_seconds"])),
                    group, feedback,
                )
                round_results.append(result)
                candidate_ids.add(candidate_id)
                state["candidate_ids"] = sorted(candidate_ids)
                save_state(run_dir, state)
        if round_results:
            winner = best_of([best] + round_results)
            if winner["score"] > best["score"]:
                best = winner
                state["best_candidate"] = best["candidate_id"]
                state["best_score"] = best["score"]
        state["rounds_completed"] = round_no
        state["next_round"] = round_no + 1
        save_state(run_dir, state)
    state["status"] = "completed"
    save_state(run_dir, state)
    judge_run(run_dir)
    write_report(run_dir)
    return state


def judge_run(run_dir: Path) -> dict[str, Any]:
    state = read_json(run_dir / "run.json")
    benchmark = read_json(run_dir / "benchmark.json")
    candidates = []
    for candidate_id in state.get("candidate_ids", []):
        record_file = candidate_path(run_dir, candidate_id) / "candidate.json"
        if not record_file.is_file():
            continue
        record = read_json(record_file)
        judgment = score_tasks(benchmark, record.get("task_results", []))
        record["judgment"] = judgment
        record["score"] = judgment["score"]
        atomic_json(record_file, record)
        candidates.append(record)
    if not candidates:
        raise Harness2Error("Run has no saved candidate outputs to judge")
    baseline = next((item for item in candidates if item["candidate_id"] == "baseline"), candidates[0])
    best = best_of(candidates)
    result = {
        "run_id": state["run_id"], "judged_at": utc_now(), "benchmark": state["benchmark"],
        "executor": state["executor"], "mode": state["mode"],
        "baseline_score": baseline["score"], "best_candidate": best["candidate_id"],
        "best_score": best["score"], "improvement": round(best["score"] - baseline["score"], 6),
        "candidates": [{
            "candidate_id": item["candidate_id"], "round": item["round"], "score": item["score"],
            "status": item["status"], "changed_components": item["changed_components"],
        } for item in candidates],
    }
    atomic_json(run_dir / "judgment.json", result)
    state["best_candidate"] = best["candidate_id"]
    state["best_score"] = best["score"]
    save_state(run_dir, state)
    return result


def write_report(run_dir: Path) -> Path:
    state = read_json(run_dir / "run.json")
    judgment_file = run_dir / "judgment.json"
    judgment = read_json(judgment_file) if judgment_file.exists() else judge_run(run_dir)
    best = load_candidate(run_dir, judgment["best_candidate"])
    lines = [
        f"# Harness2 report: {state['run_id']}", "",
        f"- Benchmark: {state['benchmark']}", f"- Executor: {state['executor']}",
        f"- Mode: {state['mode']}", f"- Status: {state['status']}",
        f"- Baseline score: {judgment['baseline_score']:.1%}",
        f"- Best score: {judgment['best_score']:.1%}",
        f"- Improvement: {judgment['improvement']:+.1%}", "",
        "## Candidate comparison", "",
        "| Candidate | Round | Score | Status | Changed components |",
        "|---|---:|---:|---|---|",
    ]
    for item in judgment["candidates"]:
        lines.append(f"| {item['candidate_id']} | {item['round']} | {item['score']:.1%} | {item['status']} | {', '.join(item['changed_components']) or 'baseline'} |")
    lines.extend(["", "## Task-level evidence", ""])
    for task in best.get("judgment", {}).get("tasks", []):
        lines.extend([f"### {task['title']} — {task['score']:.1%}", "", task["answer"] or "(no answer)", ""])
        for check in task["checks"]:
            lines.append(f"- {'PASS' if check['passed'] else 'FAIL'}: {check['kind']} — {check['value']}")
        lines.append("")
    if state["executor"] == "demo":
        lines.extend(["## Interpretation", "", "This deterministic demo checks Harness2 setup, refinement mechanics, checkpointing, judging, and reporting. It is not an AI model-quality benchmark."])
    else:
        lines.extend(["## Interpretation", "", "Scores apply only to this dataset, executor, model, and saved outputs. Review task-level evidence before drawing broader conclusions."])
    path = run_dir / "report.md"
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return path
