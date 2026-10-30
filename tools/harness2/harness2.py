#!/usr/bin/env python3
"""Harness2: resumable refinement and evaluation for AI-agent harnesses.

Python 3.12+, standard library only. Demo mode uses deterministic fixtures,
not a model-quality benchmark.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from core import (
    DEFAULT_TIMEOUT, Harness2Error, VERSION, COMPONENT_PATHS, atomic_json,
    apply_updates, load_components, load_benchmark, list_benchmarks, read_json,
    setup_workspace, load_workspace_config,
)
from executors import (
    BaseExecutor, DemoExecutor, OpenCodeExecutor, CodexExecutor, make_executor,
    parse_opencode_jsonl, parse_codex_jsonl, parse_json_object,
)
from runner import (
    judge_answer, score_tasks, run_path, candidate_path, save_state,
    evaluate_candidate, create_run, refine_run, judge_run, write_report, load_candidate,
)


def command_run(args: argparse.Namespace) -> int:
    workspace = Path(args.workspace).expanduser().resolve()
    benchmark = load_benchmark(args.benchmark, args.benchmark_file)
    run_dir, state = create_run(workspace, args.benchmark, benchmark, args)
    print(f"Run ID: {state['run_id']}")
    print(f"Checkpoint: {run_dir / 'run.json'}")
    state = refine_run(run_dir, state)
    print(f"Completed: {state['status']} — best score {state['best_score']:.1%}")
    print(f"Report: {run_dir / 'report.md'}")
    return 0


def command_resume(args: argparse.Namespace) -> int:
    workspace = Path(args.workspace).expanduser().resolve()
    run_dir = run_path(workspace, args.run_id)
    state = read_json(run_dir / "run.json")
    if state.get("status") == "completed":
        report = write_report(run_dir)
        print(f"Run already completed. Report: {report}")
        return 0
    state["status"] = "running"
    save_state(run_dir, state)
    state = refine_run(run_dir, state)
    print(f"Resumed: {state['run_id']} — {state['status']} — best {state['best_score']:.1%}")
    print(f"Report: {run_dir / 'report.md'}")
    return 0


def command_judge(args: argparse.Namespace) -> int:
    run_dir = run_path(Path(args.workspace).expanduser().resolve(), args.run_id)
    print(json.dumps(judge_run(run_dir), indent=2, ensure_ascii=False))
    return 0


def command_report(args: argparse.Namespace) -> int:
    run_dir = run_path(Path(args.workspace).expanduser().resolve(), args.run_id)
    report = write_report(run_dir)
    print(report.read_text(encoding="utf-8"))
    print(f"Saved: {report}")
    return 0


def command_doctor(args: argparse.Namespace) -> int:
    workspace = Path(args.workspace).expanduser().resolve()
    print(f"Harness2 {VERSION}")
    print(f"Python: {sys.version.split()[0]} ({'supported' if sys.version_info >= (3, 12) else 'requires Python 3.12+'})")
    print(f"Workspace: {'initialized' if (workspace / '.harness2' / 'config.json').is_file() else 'not initialized'}")
    print(f"OpenCode: {shutil.which('opencode') or 'not installed (optional)'}")
    print(f"Codex: {shutil.which('codex') or 'not installed (optional)'}")
    print("Benchmarks: " + ", ".join(item["name"] for item in list_benchmarks()))
    print("Credentials: not inspected; Harness2 never prints secret values.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="harness2", description="Refine, benchmark, judge, and resume AI-agent harnesses.")
    sub = parser.add_subparsers(dest="command", required=True)
    setup = sub.add_parser("setup", aliases=["init"], help="Create a local workspace and starter harness.")
    setup.add_argument("--workspace", default=".")
    setup.add_argument("--force", action="store_true", help="Reset starter components. Existing run data is preserved.")
    setup.set_defaults(func=lambda args: (print(f"Initialized Harness2 at {setup_workspace(Path(args.workspace), args.force)}"), 0)[1])
    listing = sub.add_parser("benchmarks", help="List built-in benchmark datasets.")
    listing.add_argument("action", nargs="?", choices=["list"], default="list")
    listing.set_defaults(func=lambda _args: (print(json.dumps(list_benchmarks(), indent=2)), 0)[1])
    doctor = sub.add_parser("doctor", help="Check local Python, workspace, executors, and benchmark availability.")
    doctor.add_argument("--workspace", default=".")
    doctor.set_defaults(func=command_doctor)
    run = sub.add_parser("run", help="Run baseline, iterative refinement, judging, and reporting.")
    run.add_argument("--workspace", default=".")
    run.add_argument("--benchmark", default="smoke")
    run.add_argument("--benchmark-file", help="Optional custom benchmark JSON file.")
    run.add_argument("--executor", choices=["demo", "opencode", "codex"])
    run.add_argument("--mode", choices=["sequential", "parallel"])
    run.add_argument("--iterations", type=int, default=4)
    run.add_argument("--parallelism", type=int, default=2)
    run.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    run.add_argument("--model", help="Optional model ID passed to the selected executor.")
    run.set_defaults(func=command_run)
    resume = sub.add_parser("resume", help="Resume an interrupted run by its saved run ID.")
    resume.add_argument("run_id")
    resume.add_argument("--workspace", default=".")
    resume.set_defaults(func=command_resume)
    judge = sub.add_parser("judge", help="Re-evaluate saved candidate outputs against benchmark criteria.")
    judge.add_argument("run_id")
    judge.add_argument("--workspace", default=".")
    judge.set_defaults(func=command_judge)
    report = sub.add_parser("report", help="Print a saved Markdown report.")
    report.add_argument("run_id")
    report.add_argument("--workspace", default=".")
    report.set_defaults(func=command_report)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if getattr(args, "iterations", 1) < 1 or getattr(args, "iterations", 1) > 50:
        parser.error("--iterations must be between 1 and 50")
    if getattr(args, "parallelism", 1) < 1 or getattr(args, "parallelism", 1) > 8:
        parser.error("--parallelism must be between 1 and 8")
    if getattr(args, "timeout", DEFAULT_TIMEOUT) < 10 or getattr(args, "timeout", DEFAULT_TIMEOUT) > 1800:
        parser.error("--timeout must be between 10 and 1800 seconds")
    try:
        return int(args.func(args))
    except Harness2Error as exc:
        print(f"Harness2 error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Interrupted. Completed candidate checkpoints remain saved; resume with the run ID.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
