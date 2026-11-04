"""
ULTRON ETERNAL — Project Prometheus Secure Self-Evolution Sandbox
Hardened Static Analysis, AST Security Verification, Sandboxed Testing, and Versioned Rollback.
"""

import ast
import os
import json
import re
from typing import Dict, Any, List, Optional

DANGEROUS_CALLS = {
    "eval", "exec", "compile", "__import__", "open", "input",
    "globals", "locals", "getattr", "setattr", "delattr"
}

DANGEROUS_MODULES = {
    "os", "sys", "subprocess", "ctypes", "socket", "urllib",
    "shutil", "winreg", "pty", "commands", "builtin"
}

DANGEROUS_ATTRIBUTES = {
    "system", "popen", "spawn", "fork", "kill", "remove", "unlink",
    "rmdir", "rename", "chmod", "chown", "environ"
}

class SelfEvolutionSandbox:
    def __init__(self, tools_dir: Optional[str] = None):
        if tools_dir is None:
            tools_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", ".local", "evolved_tools")
        self.tools_dir = os.path.abspath(tools_dir)
        os.makedirs(self.tools_dir, exist_ok=True)
        self.manifest_file = os.path.join(self.tools_dir, "evolution_registry.json")
        self._load_registry()

    def _load_registry(self):
        if os.path.exists(self.manifest_file):
            try:
                with open(self.manifest_file, "r", encoding="utf-8") as f:
                    self.registry = json.load(f)
                    return
            except Exception:
                pass
        self.registry = {"tools": {}, "history": []}

    def _save_registry(self):
        with open(self.manifest_file, "w", encoding="utf-8") as f:
            json.dump(self.registry, f, indent=2)

    def analyze_source_ast(self, source_code: str) -> Dict[str, Any]:
        """Perform comprehensive AST static analysis to reject dangerous code patterns."""
        try:
            tree = ast.parse(source_code)
        except SyntaxError as se:
            return {"safe": False, "error": f"Syntax error at line {se.lineno}: {se.msg}"}

        violations = []

        for node in ast.walk(tree):
            # Check function calls
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name) and node.func.id in DANGEROUS_CALLS:
                    violations.append(f"Forbidden call to '{node.func.id}' at line {node.lineno}")
                elif isinstance(node.func, ast.Attribute) and node.func.attr in DANGEROUS_ATTRIBUTES:
                    violations.append(f"Forbidden attribute access '{node.func.attr}' at line {node.lineno}")

            # Check imports
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    root_mod = alias.name.split('.')[0]
                    if root_mod in DANGEROUS_MODULES:
                        violations.append(f"Forbidden module import '{root_mod}' at line {node.lineno}")
            elif isinstance(node, ast.ImportFrom):
                root_mod = (node.module or '').split('.')[0]
                if root_mod in DANGEROUS_MODULES:
                    violations.append(f"Forbidden module import from '{root_mod}' at line {node.lineno}")

        is_safe = len(violations) == 0
        return {
            "safe": is_safe,
            "violations": violations,
            "total_violations": len(violations),
            "lines": len(source_code.splitlines())
        }

    def synthesize_tool(self, tool_id: str, name: str, description: str, python_code: str, author: str = "ChiefOfStaff") -> Dict[str, Any]:
        """Fail closed: static AST screening is not an execution sandbox.

        Do not write/register generated source until a separately provisioned
        OS-isolated execution adapter can validate and stage it. This Python
        runtime has no such adapter, so synthesis remains disabled.
        """
        clean_id = re.sub(r'[^a-zA-Z0-9_\\-]', '', str(tool_id or '')).lower()
        if not clean_id:
            return {"success": False, "error": "Invalid tool identifier.", "code": "INVALID_TOOL_ID"}

        analysis = self.analyze_source_ast(python_code)
        if not analysis.get("safe"):
            return {
                "success": False,
                "security_verdict": "REJECTED_UNSAFE",
                "violations": analysis.get("violations", []),
                "reason": "Code failed static AST security screening."
            }

        return {
            "success": False,
            "code": "SELF_EVOLUTION_SANDBOX_UNAVAILABLE",
            "security_verdict": "BLOCKED_NO_ISOLATED_SANDBOX",
            "reason": "AST screening is not an execution sandbox. Python tool synthesis is disabled until a verified OS-isolated validator/stager is provisioned.",
            "proposed_tool_id": clean_id
        }

    def rollback_tool(self, tool_id: str) -> Dict[str, Any]:
        clean_id = re.sub(r'[^a-zA-Z0-9_\-]', '', tool_id).lower()
        if clean_id not in self.registry["tools"]:
            return {"success": False, "error": f"Tool '{clean_id}' not found."}

        current = self.registry["tools"][clean_id]
        cur_version = current["version"]

        if cur_version <= 1:
            # Delete tool
            del self.registry["tools"][clean_id]
            self.registry["history"].append({"action": "REMOVE", "tool_id": clean_id})
            self._save_registry()
            return {"success": True, "rolled_back": True, "new_version": 0, "status": "DELETED"}

        prev_version = cur_version - 1
        prev_file = os.path.join(self.tools_dir, f"{clean_id}_v{prev_version}.py")
        current["version"] = prev_version
        current["file"] = prev_file
        self.registry["history"].append({
            "action": "ROLLBACK",
            "tool_id": clean_id,
            "from_version": cur_version,
            "to_version": prev_version
        })
        self._save_registry()

        return {
            "success": True,
            "tool_id": clean_id,
            "rolled_back_to": prev_version
        }

    def list_tools(self) -> Dict[str, Any]:
        return {
            "success": True,
            "total_tools": len(self.registry["tools"]),
            "tools": list(self.registry["tools"].values()),
            "audit_history": self.registry["history"][-10:]
        }
