import argparse
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import harness2


class Harness2Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name)
        harness2.setup_workspace(self.workspace)

    def tearDown(self):
        self.temp.cleanup()

    def make_args(self, *, mode="sequential", iterations=3, parallelism=2, executor="demo"):
        return argparse.Namespace(
            executor=executor, model=None, mode=mode, iterations=iterations,
            parallelism=parallelism, timeout=60,
        )

    def start_run(self, *, benchmark_name="smoke", mode="sequential", iterations=3, parallelism=2):
        benchmark = harness2.load_benchmark(benchmark_name)
        return harness2.create_run(
            self.workspace, benchmark_name, benchmark,
            self.make_args(mode=mode, iterations=iterations, parallelism=parallelism),
        )

    def test_setup_creates_component_surface_and_ignores_local_state(self):
        config = harness2.load_workspace_config(self.workspace)
        self.assertEqual(config["default_executor"], "demo")
        components = harness2.load_components(self.workspace / ".harness2" / "harness")
        self.assertEqual(set(components), set(harness2.COMPONENT_PATHS))
        self.assertIn(".harness2/", (self.workspace / ".gitignore").read_text(encoding="utf-8"))
        with self.assertRaises(harness2.Harness2Error):
            harness2.setup_workspace(self.workspace)

    def test_demo_sequential_refinement_judges_and_reports(self):
        run_dir, state = self.start_run(iterations=3)
        state = harness2.refine_run(run_dir, state)
        judgment = harness2.read_json(run_dir / "judgment.json")
        self.assertEqual(state["status"], "completed")
        self.assertLess(judgment["baseline_score"], 1.0)
        self.assertEqual(judgment["best_score"], 1.0)
        report = (run_dir / "report.md").read_text(encoding="utf-8")
        self.assertIn("deterministic demo", report)
        self.assertTrue((run_dir / "candidates" / "baseline" / "candidate.json").is_file())

    def test_demo_parallel_mode_saves_independent_candidates(self):
        run_dir, state = self.start_run(mode="parallel", iterations=2, parallelism=2)
        state = harness2.refine_run(run_dir, state)
        self.assertEqual(state["status"], "completed")
        self.assertIn("r01-c01", state["candidate_ids"])
        self.assertIn("r01-c02", state["candidate_ids"])
        self.assertGreaterEqual(len(state["candidate_ids"]), 5)
        self.assertGreater(state["best_score"], 0.0)

    def test_resume_uses_saved_baseline_and_candidate_checkpoints(self):
        run_dir, state = self.start_run(iterations=2)
        # Exercise the durable baseline checkpoint independently of later rounds.
        baseline_root = run_dir / "candidates" / "baseline"
        baseline_root.mkdir(parents=True)
        (baseline_root / "harness").mkdir()
        import shutil
        shutil.copytree(run_dir / "baseline-harness", baseline_root / "harness", dirs_exist_ok=True)
        work = baseline_root / "workspace"
        work.mkdir()
        baseline = harness2.evaluate_candidate(
            harness2.DemoExecutor(None, 60), harness2.read_json(run_dir / "benchmark.json"),
            baseline_root / "harness", work, "baseline", 0, None, [],
        )
        harness2.atomic_json(baseline_root / "candidate.json", baseline)
        state["candidate_ids"] = ["baseline"]
        state["best_candidate"] = "baseline"
        state["best_score"] = baseline["score"]
        state["next_round"] = 1
        harness2.save_state(run_dir, state)
        resumed = harness2.refine_run(run_dir, harness2.read_json(run_dir / "run.json"))
        self.assertEqual(resumed["status"], "completed")
        self.assertEqual(resumed["best_score"], 1.0)

    def test_component_update_rejects_unknown_name_before_writing_anything(self):
        root = self.workspace / ".harness2" / "harness"
        before = (root / "system_prompt.md").read_text(encoding="utf-8")
        with self.assertRaises(harness2.Harness2Error):
            harness2.apply_updates(root, {"system_prompt": "replace", "shell": "run arbitrary commands"}, {"system_prompt"})
        self.assertEqual((root / "system_prompt.md").read_text(encoding="utf-8"), before)

    def test_benchmark_validation_rejects_duplicate_ids_and_invalid_criteria(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bad.json"
            path.write_text(json.dumps({"tasks": [
                {"id": "same", "prompt": "one", "criteria": {"all_contains": ["ok"]}},
                {"id": "same", "prompt": "two", "criteria": {}}
            ]}), encoding="utf-8")
            with self.assertRaises(harness2.Harness2Error):
                harness2.load_benchmark("custom", str(path))

    def test_score_judge_supports_required_any_forbidden_and_min_length(self):
        judgment = harness2.judge_answer("one of these words is here", {
            "all_contains": ["one"], "any_contains": ["absent", "words"],
            "forbidden_contains": ["secret"], "min_chars": 10,
        })
        self.assertEqual(judgment["score"], 1.0)

    def test_opencode_and_codex_jsonl_extract_final_text(self):
        opencode = '\n'.join([
            json.dumps({"type": "step_start"}),
            json.dumps({"type": "text", "part": {"type": "text", "text": '{"answer":"hello"}'}}),
        ])
        self.assertIn("hello", harness2.parse_opencode_jsonl(opencode))
        codex = '\n'.join([
            json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": '{"answer":"world"}'}}),
            json.dumps({"type": "turn.completed"}),
        ])
        self.assertIn("world", harness2.parse_codex_jsonl(codex))

    def test_opencode_executor_uses_temporary_readonly_agent_and_never_the_repository(self):
        stdout = json.dumps({"type": "text", "part": {"type": "text", "text": '{"answer":"read-only"}'}})
        completed = __import__("subprocess").CompletedProcess([], 0, stdout, "")
        captured = {}
        def fake_run(command, **kwargs):
            captured["command"] = command
            captured["cwd"] = Path(kwargs["cwd"]).resolve()
            captured["config"] = json.loads(Path(kwargs["env"]["OPENCODE_CONFIG"]).read_text(encoding="utf-8"))
            agent = Path(kwargs["env"]["OPENCODE_CONFIG_DIR"]) / "agents" / "harness2-readonly.md"
            captured["agent"] = agent.read_text(encoding="utf-8")
            return completed
        with patch.object(harness2.subprocess, "run", side_effect=fake_run):
            answer = harness2.OpenCodeExecutor("provider/model", 30).ask("answer", self.workspace)
        self.assertEqual(harness2.parse_json_object(answer)["answer"], "read-only")
        command = captured["command"]
        self.assertIn("--pure", command)
        self.assertIn("--format", command)
        self.assertIn("--agent", command)
        self.assertNotEqual(captured["cwd"], self.workspace.resolve())
        self.assertEqual(captured["config"]["permission"]["*"], "deny")
        self.assertEqual(captured["config"]["permission"]["read"], "allow")
        self.assertIn("mode: primary", captured["agent"])

    def test_codex_executor_uses_readonly_ephemeral_noninteractive_invocation(self):
        stdout = json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": '{"answer":"codex-read-only"}'}})
        completed = __import__("subprocess").CompletedProcess([], 0, stdout, "")
        with patch.object(harness2.subprocess, "run", return_value=completed) as run:
            answer = harness2.CodexExecutor("local/model", 30).ask("answer", self.workspace)
        self.assertEqual(harness2.parse_json_object(answer)["answer"], "codex-read-only")
        command = run.call_args.args[0]
        self.assertIn("exec", command)
        self.assertIn("--sandbox", command)
        self.assertIn("read-only", command)
        self.assertIn("--ask-for-approval", command)
        self.assertIn("never", command)
        self.assertIn("--ephemeral", command)
        self.assertIn("--ignore-user-config", command)
        self.assertEqual(command[-1], "-")
        self.assertEqual(run.call_args.kwargs["input"], "answer")
        self.assertNotEqual(Path(run.call_args.kwargs["cwd"]).resolve(), self.workspace.resolve())

    def test_path_validation_rejects_traversal(self):
        with self.assertRaises(harness2.Harness2Error):
            harness2.run_path(self.workspace, "../escape")
        with self.assertRaises(harness2.Harness2Error):
            harness2.candidate_path(self.workspace, "../../escape")



    def test_setup_rejects_symlinked_state_and_harness_directories(self):
        with tempfile.TemporaryDirectory() as outer:
            outer_path = Path(outer)
            external = outer_path / "external"
            external.mkdir()
            (external / "keep.txt").write_text("untouched", encoding="utf-8")
            workspace = outer_path / "workspace"
            workspace.mkdir()
            (workspace / ".harness2").symlink_to(external, target_is_directory=True)
            with self.assertRaises(harness2.Harness2Error):
                harness2.setup_workspace(workspace)
            self.assertEqual((external / "keep.txt").read_text(encoding="utf-8"), "untouched")

        with tempfile.TemporaryDirectory() as outer:
            outer_path = Path(outer)
            external = outer_path / "external-harness"
            external.mkdir()
            (external / "keep.txt").write_text("untouched", encoding="utf-8")
            workspace = outer_path / "workspace"
            workspace.mkdir()
            (workspace / ".harness2").mkdir()
            (workspace / ".harness2" / "harness").symlink_to(external, target_is_directory=True)
            with self.assertRaises(harness2.Harness2Error):
                harness2.setup_workspace(workspace)
            self.assertEqual((external / "keep.txt").read_text(encoding="utf-8"), "untouched")

if __name__ == "__main__":
    unittest.main()
