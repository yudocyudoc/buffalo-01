"""Replay the archived failed experiment without executing Simlin or changing its gate."""
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent / "evidence" / "45581831904"
REPORT_SHA256 = "297dfd6aebf2196cc314e288081e169198a6c9fdbb952a16046f3ce09a01ee77"
IMAGE_SHA256 = "0a50e6dea12d9d1116088f92ae5e8c9bad7799183b5e3bf31be71e5fd473df0c"

def require(ok, message):
    if not ok:
        raise AssertionError(message)

def verified(name, expected):
    raw = (BASE / name).read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected, "ARCHIVE_HASH_MISMATCH:" + name)
    return raw

def metrics(errors):
    return {"n": len(errors), "max_abs_pp": max(errors), "mean_abs_pp": sum(errors)/len(errors)}

def diagnose():
    report = json.loads(verified("ltm-candidate.json", REPORT_SHA256))
    verified("ltm-image-id.txt", IMAGE_SHA256)
    require(report["status"] == "NUMERICAL_MISMATCH", "ORIGINAL_VERDICT_CHANGED")
    require(report["paper_tables_2_3"]["passed"] and report["births_deaths"]["passed"], "PRIOR_EXPERIMENTS")
    b = report["bass"]
    require(not b["passed"], "BASS_VERDICT_CHANGED")
    require(b["time"] == [i/16 for i in range(241)], "TIME_GRID")
    a = b["trajectory"]["Adopters"]
    require(len(a) == 241, "ADOPTERS_GRID")
    results = {}
    for name, share in [("R1", lambda x: 100*(1-x/1000000)), ("B1", lambda x: 100*x/1000000)]:
        loop = b["loops"][name]
        sim = [100*abs(s) for s in loop["signed_relative_scores"]]
        ref = loop["reference_percent"]
        require(len(sim) == len(ref) == 241 and sim[0] == ref[0] == 0, "SCORE_GRID")
        same = metrics([abs(s-r) for s,r in zip(sim,ref)])
        overlap = metrics([abs(sim[i+1]-ref[i]) for i in range(1,240)])
        previous = metrics([abs(sim[i]-share(a[i-1])) for i in range(1,241)])
        current = metrics([abs(ref[i]-share(a[i])) for i in range(1,241)])
        require(same["max_abs_pp"] > report["tolerances"]["bass_score_abs_percentage_points"], "ORIGINAL_GATE")
        require(abs(same["max_abs_pp"] - loop["max_error_pp"]) < 1e-12, "REPORTED_MAX")
        require(max(overlap["max_abs_pp"],previous["max_abs_pp"],current["max_abs_pp"]) < 1e-10, "TIMING_HYPOTHESIS")
        results[name] = {"same_time": same, "one_step_overlap_only": overlap,
                         "simlin_previous_stock": previous, "reference_current_stock": current,
                         "unpaired_active_simlin_first": sim[1], "unpaired_active_reference_last": ref[-1]}
    require(b["balancing_transitions"] == [9.6875], "SIMLIN_BOUNDARY")
    require(report["tolerances"]["bass_transition_expected"] == 9.625, "REFERENCE_BOUNDARY")
    return {"status":"TIMING_HYPOTHESIS_SUPPORTED_ON_ARCHIVED_BASS",
            "original_admission_status":report["status"],"admitted":False,
            "reference_transition":9.625,"simlin_transition":9.6875,"dt":0.0625,
            "source_report_sha256":REPORT_SHA256,"loops":results,
            "scope":"Retrospective diagnostic, not an acceptance criterion or general backend timing rule."}

if __name__ == "__main__":
    print(json.dumps(diagnose(), indent=2, allow_nan=False))
