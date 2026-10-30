import json, subprocess, sys, tempfile, unittest
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "harness2"))
import harness2

class Harness2Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        harness2.setup(self.root)
    def tearDown(self): self.tmp.cleanup()
    def test_setup_components_and_guard(self):
        parts = harness2.load_components(self.root / ".harness2" / "harness")
        self.assertEqual(set(parts), set(harness2.COMPONENTS))
        with self.assertRaises(harness2.Harness2Error): harness2.setup(self.root)
    def test_demo_sequential_refinement_and_report(self):
        args = type("Args", (), {"workspace":str(self.root),"benchmark":"smoke","benchmark_file":None,"executor":"demo","mode":"sequential","iterations":3,"parallelism":2,"timeout":60,"model":None})()
        workspace = self.root.resolve()
        config = harness2.read_json(workspace / ".harness2" / "config.json")
        benchmark = harness2.load_benchmark("smoke")
        import datetime as dt, uuid
        run_id = dt.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
        root = harness2.run_path(workspace, run_id); root.mkdir(parents=True)
        import shutil
        shutil.copytree(workspace / config["harness_path"], root / "baseline-harness")
        harness2.atomic_json(root / "benchmark.json", benchmark)
        state = {"run_id":run_id,"status":"running","benchmark":"smoke","executor":"demo","model":None,"mode":"sequential","iterations":3,"parallelism":2,"next_round":0,"candidate_ids":[]}
        harness2.atomic_json(root / "run.json", state)
        harness2.execute(root, state, 60)
        saved = harness2.read_json(root / "run.json")
        self.assertEqual(saved["status"], "completed")
        self.assertGreater(saved["best_score"], 0)
        self.assertTrue((root / "report.md").is_file())
    def test_parallel_mode_creates_and_scores_multiple_candidates(self):
        workspace = self.root.resolve()
        config = harness2.read_json(workspace / ".harness2" / "config.json")
        benchmark = harness2.load_benchmark("smoke")
        import datetime as dt, uuid, shutil
        run_id = dt.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
        root = harness2.run_path(workspace, run_id); root.mkdir(parents=True)
        shutil.copytree(workspace / config["harness_path"], root / "baseline-harness")
        harness2.atomic_json(root / "benchmark.json", benchmark)
        state = {"run_id":run_id,"status":"running","benchmark":"smoke","executor":"demo","model":None,"mode":"parallel","iterations":5,"parallelism":2,"next_round":0,"candidate_ids":[]}
        harness2.atomic_json(root / "run.json", state)
        harness2.execute(root, state, 60)
        saved = harness2.read_json(root / "run.json")
        self.assertIn("r01-c01", saved["candidate_ids"])
        self.assertIn("r01-c02", saved["candidate_ids"])
        self.assertEqual(saved["best_score"], 1.0)

    def test_parallel_refinement(self):
        self.assertEqual(harness2.judge("a b", {"all_contains":["a"]})["score"], 1)
    def test_update_allowlist_is_checked_before_write(self):
        harness = self.root / ".harness2" / "harness"
        before = harness2.load_components(harness)["system_prompt"]
        with self.assertRaises(harness2.Harness2Error):
            harness2.apply_updates(harness, {"system_prompt":"new","shell":"bad"}, {"system_prompt"})
        self.assertEqual(harness2.load_components(harness)["system_prompt"], before)
    def test_duplicate_benchmark_ids_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bad.json"
            path.write_text(json.dumps({"tasks":[{"id":"same","prompt":"one"},{"id":"same","prompt":"two"}]}))
            with self.assertRaises(harness2.Harness2Error): harness2.load_benchmark("custom", str(path))
    def test_cli_setup_run_judge_report_and_resume(self):
        script = Path(__file__).resolve().parents[1] / "tools" / "harness2" / "harness2.py"
        workspace = self.root / "cli-workspace"
        workspace.mkdir()
        def call(*args):
            return subprocess.run([sys.executable, str(script), *args], cwd=workspace,
                capture_output=True, text=True, timeout=30, check=True)
        call("setup", "--workspace", str(workspace))
        run_result = call("run", "--workspace", str(workspace), "--benchmark", "smoke",
            "--executor", "demo", "--mode", "sequential", "--iterations", "2")
        match = __import__("re").search(r"Run ID: ([0-9]{8}-[0-9]{6}-[a-f0-9]{8})", run_result.stdout)
        self.assertIsNotNone(match)
        run_id = match.group(1)
        self.assertIn("Report:", run_result.stdout)
        self.assertIn("Rejudged saved results", call("judge", run_id, "--workspace", str(workspace)).stdout)
        self.assertIn("# Harness2 report", call("report", run_id, "--workspace", str(workspace)).stdout)
        self.assertIn("Resumed:", call("resume", run_id, "--workspace", str(workspace)).stdout)

    def test_candidate_paths_reject_traversal_and_symlinks(self):
        run_root = self.root / ".harness2" / "runs" / "20261031-120000-abcdef12"
        candidates = run_root / "candidates"
        candidates.mkdir(parents=True)
        with self.assertRaises(harness2.Harness2Error):
            harness2.candidate_dir(run_root, "../../outside")
        outside = self.root / "outside"
        outside.mkdir()
        (candidates / "baseline").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(harness2.Harness2Error):
            harness2.candidate_dir(run_root, "baseline")

    def test_codex_executor_uses_readonly_ephemeral_cli(self):
        stdout = json.dumps({"type":"item.completed","item":{"type":"agent_message","text":"hello"}})
        completed = subprocess.CompletedProcess([], 0, stdout, "")
        with patch.object(harness2.subprocess, "run", return_value=completed) as mocked:
            self.assertEqual(harness2.Executor("codex", None, 30).ask("prompt"), "hello")
        command = mocked.call_args.args[0]
        for flag in ("exec", "--json", "--sandbox", "read-only", "--ask-for-approval",
                     "never", "--ephemeral", "--ignore-user-config", "--ignore-rules",
                     "--skip-git-repo-check"):
            self.assertIn(flag, command)
        self.assertEqual(command[-1], "-")
        self.assertEqual(mocked.call_args.kwargs["input"], "prompt")
        self.assertNotEqual(Path(mocked.call_args.kwargs["cwd"]).resolve(), self.root.resolve())

    def test_opencode_executor_uses_temporary_deny_by_default_agent(self):
        stdout = json.dumps({"type":"text","part":{"text":"hello"}})
        completed = subprocess.CompletedProcess([], 0, stdout, "")
        captured = {}
        def fake_run(command, **kwargs):
            captured["command"] = command
            captured["cwd"] = Path(kwargs["cwd"]).resolve()
            captured["env"] = kwargs["env"]
            captured["config"] = json.loads(Path(kwargs["env"]["OPENCODE_CONFIG"]).read_text())
            agent = Path(kwargs["env"]["OPENCODE_CONFIG_DIR"]) / "agents" / "harness2-readonly.md"
            captured["agent"] = agent.read_text()
            return completed
        with patch.object(harness2.subprocess, "run", side_effect=fake_run):
            self.assertEqual(harness2.Executor("opencode", None, 30).ask("prompt"), "hello")
        command = captured["command"]
        for flag in ("--pure", "run", "--agent", "harness2-readonly", "--format", "json", "--dir"):
            self.assertIn(flag, command)
        self.assertEqual(captured["config"]["permission"]["*"], "deny")
        self.assertEqual(captured["config"]["permission"]["read"], "allow")
        self.assertIn("mode: primary", captured["agent"])
        self.assertEqual(captured["env"]["OPENCODE_DISABLE_DEFAULT_PLUGINS"], "1")
        self.assertNotEqual(captured["cwd"], self.root.resolve())

    def test_executor_jsonl_parsing(self):
        opencode = json.dumps({"type":"text","part":{"text":"hello"}})
        codex = json.dumps({"type":"item.completed","item":{"type":"agent_message","text":"world"}})
        self.assertEqual(harness2.parse_jsonl(opencode,"opencode"),"hello")
        self.assertEqual(harness2.parse_jsonl(codex,"codex"),"world")

if __name__ == "__main__": unittest.main()
