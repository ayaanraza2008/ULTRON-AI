"""
ULTRON ETERNAL — IoT Smart Home & Ambient Lighting Overlord
Tuya / Smart Life Local Protocol & MQTT Home Automation Dominion.
"""

from typing import Dict, Any, List, Optional

class IoTEngine:
    def __init__(self):
        self.devices = {
            "ambient_arc_light": {"id": "arc_01", "name": "ARC Reactor Room Lighting", "state": "ON", "brightness": 85, "color": "cyan"},
            "workstation_strip": {"id": "strip_02", "name": "Workstation LED Strip", "state": "ON", "brightness": 90, "color": "blue"},
            "smart_plug_monitor": {"id": "plug_03", "name": "Main Displays Power Switch", "state": "ON"}
        }

    def list_devices(self) -> Dict[str, Any]:
        return {
            "success": True,
            "device_count": len(self.devices),
            "devices": list(self.devices.values())
        }

    def set_device_state(self, device_key: str, state: str, brightness: Optional[int] = None, color: Optional[str] = None) -> Dict[str, Any]:
        if device_key not in self.devices:
            # Check by id
            found = None
            for k, d in self.devices.items():
                if d["id"] == device_key or d["name"].lower() == device_key.lower():
                    found = k
                    break
            if not found:
                return {"success": False, "error": f"Device '{device_key}' not found in IoT registry."}
            device_key = found

        dev = self.devices[device_key]
        dev["state"] = state.upper()
        if brightness is not None:
            dev["brightness"] = max(0, min(100, int(brightness)))
        if color is not None:
            dev["color"] = color

        return {
            "success": True,
            "device": dev,
            "applied": True
        }

    def trigger_scene(self, scene_name: str) -> Dict[str, Any]:
        scene_name = scene_name.upper()
        if scene_name == "CINEMA":
            self.set_device_state("ambient_arc_light", "ON", brightness=20, color="deep_red")
            self.set_device_state("workstation_strip", "OFF")
        elif scene_name == "GAMING":
            self.set_device_state("ambient_arc_light", "ON", brightness=80, color="purple")
            self.set_device_state("workstation_strip", "ON", brightness=100, color="neon_green")
        elif scene_name == "FOCUS":
            self.set_device_state("ambient_arc_light", "ON", brightness=100, color="warm_white")
            self.set_device_state("workstation_strip", "ON", brightness=80, color="white")
        elif scene_name == "STEALTH":
            self.set_device_state("ambient_arc_light", "OFF")
            self.set_device_state("workstation_strip", "ON", brightness=10, color="crimson")
        else: # NORMAL / DEFAULT
            self.set_device_state("ambient_arc_light", "ON", brightness=75, color="cyan")
            self.set_device_state("workstation_strip", "ON", brightness=75, color="blue")

        return {
            "success": True,
            "scene": scene_name,
            "applied_states": list(self.devices.values())
        }
