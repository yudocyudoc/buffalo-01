"""Read one upstream-converted XMILE model; emit one native simulation and its LTM."""
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import sys
import tempfile
import xml.etree.ElementTree as ET

import simlin


def scores(values):
    if values is None:
        return None
    return [float(x) if math.isfinite(x) else None for x in values]


def measure(xml):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "project.xmile"
        path.write_bytes(xml)
        model = simlin.load(path)
        specs = json.loads(model.project.serialize_json())["simSpecs"]
        with model.simulate(enable_ltm=True) as simulation:
            simulation.run_to_end()
            run = simulation.get_run()
            frame = run.results
            series = {str(k): frame[k].tolist() for k in frame.columns}
            series["time"] = frame.index.tolist()
            links = [{"from": e.from_var, "to": e.to_var, "polarity": str(e.polarity),
                      "raw": scores(e.score)}
                     for e in simulation.get_links()]
            loops = []
            for loop in run.loops:
                nodes = list(loop.variables)
                if len(nodes) > 1 and nodes[0] == nodes[-1]:
                    nodes.pop()
                relative_scores = scores(loop.behavior_time_series)
                loops.append({"id": loop.id, "cycle": nodes, "partition": loop.partition,
                              "polarity": str(loop.polarity),
                              "signed": relative_scores})
            periods = [{"startTime": float(p.start_time), "endTime": float(p.end_time),
                        "partition": p.partition, "dominantLoops": list(p.dominant_loops)}
                       for p in run.dominant_periods]
            return {"series": series, "specs": specs, "links": links, "loops": loops,
                    "periods": periods, "mode": run.ltm_mode}


def main():
    version = importlib.metadata.version("pysimlin")
    if version != "0.8.5":
        raise RuntimeError("Unexpected pysimlin version")
    data = json.load(sys.stdin)
    root = ET.fromstring(data["xmile"])
    ns = "{http://docs.oasis-open.org/xmile/ns/XMILE/v1.0}"
    ET.register_namespace("", ns[1:-1])
    specs = root.find(ns + "sim_specs")
    units = specs.find(ns + "time_units")
    if units is not None:
        specs.set("time_units", units.text)
        specs.remove(units)
    if data.get("saveStep") is not None:
        ET.register_namespace("isee", "http://iseesystems.com/XMILE")
        specs.set("{http://iseesystems.com/XMILE}save_interval", str(data["saveStep"]))
    xml = ET.tostring(root, encoding="utf-8")
    result = measure(xml)
    result["xmile_sha256"] = hashlib.sha256(xml).hexdigest()
    result["version"] = version
    dist = importlib.metadata.distribution("pysimlin")
    # RECORD identifies the installed wheel contents, including its native library.
    result["implementation_sha256"] = hashlib.sha256(dist.read_text("RECORD").encode()).hexdigest()
    json.dump(result, sys.stdout, allow_nan=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
