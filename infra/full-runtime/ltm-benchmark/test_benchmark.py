import unittest
import numpy as np
from benchmark import cycle, reference_cycle, grid_indices, partition_equivalence, safe_import_copy, compare

class ContractTests(unittest.TestCase):
    def test_cycle_rotation_not_reversal(self):
        self.assertEqual(cycle(["A","B","C"]), cycle(["B","C","A"]))
        self.assertNotEqual(cycle(["A","B","C"]), cycle(["C","B","A"]))
        with self.assertRaises(ValueError):
            reference_cycle([{"from":"A","to":"C"},{"from":"B","to":"A"}])

    def test_exact_time_only(self):
        self.assertEqual(grid_indices([0, .5, 1, 1.5], [0,1]), [0,2])
        self.assertIsNone(grid_indices([0,.5,1], [0,.500001,1]))

    def test_denominator_membership(self):
        a,b,c = cycle(["A","B"]), cycle(["C","D"]), cycle(["E","F"])
        n = {a:{"partition":3}, b:{"partition":3}, c:{"partition":4}}
        self.assertEqual(partition_equivalence({"set1":{a,b},"set2":{c}}, n), {"set1":3,"set2":4})
        self.assertIsNone(partition_equivalence({"whole-model":{a,b,c}}, n))
        self.assertIsNone(partition_equivalence({"set1":{a,b}}, n))

    def test_only_unsigned_empty_metadata(self):
        prefix=b'<xmile xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">\n'
        block=b'\t<ai_information>\n\t\t<status verified="false"/>\n\t\t<testing signed_message_body=""/>\n\t</ai_information>\n'
        suffix=b'<model/></xmile>'
        result, provenance=safe_import_copy(prefix+block+suffix)
        self.assertEqual(result,prefix+suffix)
        self.assertEqual(provenance["removed_bytes"],len(block))
        self.assertIsNone(safe_import_copy(prefix+block.replace(b'verified="false"',b'verified="true"')+suffix))

    def test_same_time_mismatch_and_no_cross_partition_errors(self):
        a,b=cycle(["A","B"]),cycle(["C","D"])
        reference={a:{"id":"R1","group":"whole-model","polarity":"+","scores":np.array([0,60,40])},
                   b:{"id":"B1","group":"whole-model","polarity":"-","scores":np.array([0,40,60])}}
        native={a:{"id":"r","partition":0,"polarity":"R","scores":np.array([0,.6,.4])},
                b:{"id":"b","partition":0,"polarity":"B","scores":np.array([0,-.4,-.6])}}
        periods=[{"startTime":0,"endTime":2,"dominantLoops":["R1"]},{"startTime":2,"endTime":2,"dominantLoops":["B1"]}]
        observed=[{"start":1,"end":1,"loops":["r"]},{"start":2,"end":2,"loops":["b"]}]
        def check():
            report={"ltm_mode":"exhaustive"}
            compare([0,1,2],reference,{"whole-model":{a,b}},periods,[0,1,2],native,observed,report)
            return report
        self.assertEqual(check()["status"],"NATIVE_SCORE_AND_PERIOD_MATCH_ON_REFERENCE_GRID")
        native[a]["scores"][1]=.7
        self.assertFalse(check()["checks"]["all_reference_samples_within_tolerance"])
        native[b]["partition"]=1
        report=check()
        self.assertEqual(report["status"],"NOT_COMPARABLE_GRID_OR_TOPOLOGY_OR_DENOMINATOR")
        self.assertTrue(all("max_error_pp" not in l for l in report["loop_comparisons"]))

if __name__=="__main__":
    unittest.main()
