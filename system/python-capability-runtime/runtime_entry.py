"""
ULTRON ETERNAL — Python Capability Runtime Gateway
Unified Entry Point for Python Subsystems (Cerebro, Airspace, Desktop, DSP, Biometrics, IoT, Prometheus).
"""

import sys
import os
import json
import time
import argparse
from typing import Dict, Any

# Ensure local capabilities directory is in sys.path
sys.path.insert(0, os.path.dirname(__file__))

def get_health() -> Dict[str, Any]:
    return {
        "status": "OPERATIONAL",
        "runtime": "Python-Capability-Runtime",
        "python_version": sys.version.split()[0],
        "platform": sys.platform,
        "capabilities": [
            "cerebro_knowledge_graph",
            "desktop_controller",
            "airspace_recon",
            "network_sentinel",
            "voice_dsp_sfx",
            "biometric_sentinel",
            "spatial_gesture",
            "iot_smart_home",
            "self_evolution_sandbox"
        ],
        "hardware_optimization": {
            "target": "AMD Ryzen 7 5700U",
            "mode": "CPU_FIRST",
            "cuda_required": False,
            "lazy_loading": True
        }
    }

def dispatch_call(capability: str, method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.perf_counter()

    if capability == "cerebro":
        from capabilities.cerebro_engine import CerebroEngine
        user_id = payload.get("user_id", "default_user")
        engine = CerebroEngine(user_id=user_id)
        if method == "upsert_node":
            res = engine.upsert_node(
                node_id=payload.get("node_id"),
                label=payload.get("label", ""),
                content=payload.get("content", ""),
                node_type=payload.get("node_type", "entity"),
                metadata=payload.get("metadata")
            )
        elif method == "link_entities":
            res = engine.link_entities(
                source_id=payload.get("source_id"),
                target_id=payload.get("target_id"),
                relation=payload.get("relation", "relates_to"),
                weight=payload.get("weight", 1.0),
                bidirectional=payload.get("bidirectional", True)
            )
        elif method == "semantic_query":
            res = engine.semantic_query(query=payload.get("query", ""), top_k=payload.get("top_k", 5))
        elif method == "multi_hop_recall":
            res = engine.multi_hop_recall(
                start_id=payload.get("start_id"),
                target_id=payload.get("target_id"),
                max_hops=payload.get("max_hops", 3)
            )
        elif method == "get_metrics":
            res = engine.get_metrics()
        else:
            raise ValueError(f"Unknown method '{method}' for Cerebro")

    elif capability == "desktop":
        from capabilities.desktop_controller import DesktopController
        ctl = DesktopController()
        if method == "get_volume":
            res = ctl.get_volume()
        elif method == "set_volume":
            res = ctl.set_volume(payload.get("level", 75))
        elif method == "mute_volume":
            res = ctl.mute_volume(payload.get("mute", True))
        elif method == "get_brightness":
            res = ctl.get_brightness()
        elif method == "set_brightness":
            res = ctl.set_brightness(payload.get("level", 80))
        elif method == "get_clipboard":
            res = ctl.get_clipboard()
        elif method == "set_clipboard":
            res = ctl.set_clipboard(payload.get("text", ""))
        elif method == "clear_clipboard":
            res = ctl.clear_clipboard()
        elif method == "list_processes":
            res = ctl.list_processes(top_n=payload.get("top_n", 10), sort_by=payload.get("sort_by", "memory"))
        elif method == "kill_process":
            res = ctl.kill_process(pid=payload.get("pid"), name=payload.get("name"))
        elif method == "focus_window":
            res = ctl.focus_window(payload.get("window_title", ""))
        elif method == "scan_purge_targets":
            res = ctl.scan_purge_targets()
        elif method == "execute_purge":
            res = ctl.execute_purge(dry_run=payload.get("dry_run", False))
        elif method == "lock_workstation":
            res = ctl.lock_workstation()
        elif method == "get_system_telemetry":
            res = ctl.get_system_telemetry()
        else:
            raise ValueError(f"Unknown method '{method}' for Desktop")

    elif capability == "airspace":
        from capabilities.airspace_engine import AirspaceEngine
        eng = AirspaceEngine()
        if method == "scan_bluetooth":
            res = eng.scan_bluetooth(timeout_sec=payload.get("timeout_sec", 5))
        elif method == "scan_wifi_airspace":
            res = eng.scan_wifi_airspace()
        else:
            raise ValueError(f"Unknown method '{method}' for Airspace")

    elif capability == "network":
        from capabilities.network_sentinel import NetworkSentinel
        net = NetworkSentinel()
        if method == "scan_local_subnet":
            res = net.scan_local_subnet()
        elif method == "audit_dns_resolvers":
            res = net.audit_dns_resolvers(test_domain=payload.get("test_domain", "google.com"))
        else:
            raise ValueError(f"Unknown method '{method}' for Network")

    elif capability == "voice_dsp":
        from capabilities.voice_dsp_engine import VoiceDSPEngine
        dsp = VoiceDSPEngine()
        if method == "synth_sfx":
            res = dsp.synth_sfx(sfx_type=payload.get("sfx_type", "repulsor"), duration_sec=payload.get("duration_sec", 0.5))
        elif method == "apply_warp":
            res = dsp.apply_warp(pitch_semitones=payload.get("pitch_semitones", -3.5), formant_shift=payload.get("formant_shift", 0.85))
        else:
            raise ValueError(f"Unknown method '{method}' for Voice DSP")

    elif capability == "biometrics":
        from capabilities.biometric_engine import BiometricEngine
        bio = BiometricEngine()
        if method == "enroll_boss_face":
            res = bio.enroll_boss_face(label=payload.get("label", "Boss"), face_data=payload.get("face_data"))
        elif method == "authenticate_face":
            res = bio.authenticate_face(input_image=payload.get("input_image"))
        elif method == "get_status":
            res = bio.get_status()
        else:
            raise ValueError(f"Unknown method '{method}' for Biometrics")

    elif capability == "gestures":
        from capabilities.gesture_engine import GestureEngine
        gest = GestureEngine()
        if method == "list_supported_gestures":
            res = gest.list_supported_gestures()
        elif method == "process_gesture_frame":
            res = gest.process_gesture_frame(frame_metadata=payload.get("frame_metadata", {}))
        else:
            raise ValueError(f"Unknown method '{method}' for Gestures")

    elif capability == "iot":
        from capabilities.iot_engine import IoTEngine
        iot = IoTEngine()
        if method == "list_devices":
            res = iot.list_devices()
        elif method == "set_device_state":
            res = iot.set_device_state(
                device_key=payload.get("device_key", ""),
                state=payload.get("state", "ON"),
                brightness=payload.get("brightness"),
                color=payload.get("color")
            )
        elif method == "trigger_scene":
            res = iot.trigger_scene(scene_name=payload.get("scene_name", "FOCUS"))
        else:
            raise ValueError(f"Unknown method '{method}' for IoT")

    elif capability == "self_evolution":
        from capabilities.self_evolution_sandbox import SelfEvolutionSandbox
        prom = SelfEvolutionSandbox()
        if method == "analyze_source_ast":
            res = prom.analyze_source_ast(source_code=payload.get("source_code", ""))
        elif method == "synthesize_tool":
            res = prom.synthesize_tool(
                tool_id=payload.get("tool_id", ""),
                name=payload.get("name", ""),
                description=payload.get("description", ""),
                python_code=payload.get("python_code", ""),
                author=payload.get("author", "ChiefOfStaff")
            )
        elif method == "rollback_tool":
            res = prom.rollback_tool(tool_id=payload.get("tool_id", ""))
        elif method == "list_tools":
            res = prom.list_tools()
        else:
            raise ValueError(f"Unknown method '{method}' for Self Evolution")

    else:
        raise ValueError(f"Unknown capability: '{capability}'")

    duration_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    return {
        "success": True,
        "capability": capability,
        "method": method,
        "data": res,
        "metrics": {"duration_ms": duration_ms}
    }

def main():
    parser = argparse.ArgumentParser(description="ULTRON Python Capability Runtime")
    parser.add_argument("--health", action="store_true", help="Print runtime health status")
    parser.add_argument("--capability", type=str, help="Capability domain")
    parser.add_argument("--method", type=str, help="Method name")
    parser.add_argument("--payload", type=str, default="{}", help="JSON string payload")
    parser.add_argument("--stdin", action="store_true", help="Read JSON payload from stdin")

    args = parser.parse_args()

    if args.health:
        print(json.dumps(get_health(), indent=2))
        return

    if not args.capability or not args.method:
        print(json.dumps({"success": False, "error": {"code": "INVALID_INVOCATION", "message": "Missing capability or method"}}))
        sys.exit(1)

    raw_payload = args.payload
    if args.stdin:
        raw_payload = sys.stdin.read()

    try:
        payload = json.loads(raw_payload) if raw_payload.strip() else {}
    except Exception as e:
        print(json.dumps({"success": False, "error": {"code": "MALFORMED_JSON", "message": str(e)}}))
        sys.exit(1)

    try:
        output = dispatch_call(args.capability, args.method, payload)
        print(json.dumps(output))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "capability": args.capability,
            "method": args.method,
            "error": {"code": "EXECUTION_ERROR", "message": str(e)}
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
