import math
from pathlib import Path
import sys
import unittest
from oracle import controls, flow_tables, relative, pulse_rows, bass


class OracleTests(unittest.TestCase):
    def test_linear(self):
        d=controls()["additive"]
        for mode in ("first","last"):
            self.assertEqual([l["partial"] for l in d[mode]["links"]],[2,6])
            self.assertEqual([l["score"] for l in d[mode]["links"]],[.25,.75])

    def test_product(self):
        d=controls()["product"]
        self.assertEqual([l["partial"] for l in d["first"]["links"]],[3,12])
        self.assertEqual([l["partial"] for l in d["last"]["links"]],[9,18])
        self.assertEqual(d["first"]["unallocated_change"],6)
        self.assertEqual(d["last"]["unallocated_change"],-6)

    def test_asymmetric(self):
        d=controls()["asymmetric"]
        self.assertEqual([l["partial"] for l in d["first"]["links"]],[15,24])
        self.assertEqual([l["partial"] for l in d["last"]["links"]],[45,54])

    def test_cancellation(self):
        d=controls()["cancellation"]["first"]
        self.assertTrue(d["zero_denominator"])
        self.assertEqual([l["score"] for l in d["links"]],[0,0])
        self.assertEqual(relative([0,0]),[0,0])

    def test_polarity_and_unchanged(self):
        d=controls()
        self.assertEqual([l["score"] for l in d["negative_polarity"]["first"]["links"]],[1,-2])
        self.assertEqual(d["unchanged_input"]["last"]["links"][0]["score"],0)
        self.assertEqual(relative([2,-1]),[2/3,-1/3])

    def test_paper_flow_tables(self):
        d=flow_tables()
        self.assertEqual(d["stocks"],[100,101,106])
        self.assertEqual(d["table3_direct"],[1.25,-.25])
        self.assertEqual([l["score"]*d["net_to_stock"] for l in d["table2_net"]["links"]],d["table3_direct"])
        self.assertNotEqual(d["table1_original"],d["table3_direct"])

    def test_pulse_discriminates(self):
        rows=pulse_rows()
        self.assertEqual(rows[0]["x"],2)
        self.assertEqual(rows[1]["x"],3.012)
        self.assertEqual([r["y"] for r in rows],[3,4,5,9,13,17])
        # A timestamp shift cannot generally reproduce changed-last.
        r=rows[2]["hypotheses"]
        a=[l["score"] for l in r["last_end"]["links"]]
        b=[l["score"] for l in r["first_start"]["links"]]
        self.assertGreater(max(abs(x-y) for x,y in zip(a,b)),.01)
        self.assertNotIn("first_end",rows[0]["hypotheses"])
        self.assertNotIn("first_start",rows[-1]["hypotheses"])

    def test_bass(self):
        d=bass(REF)
        self.assertEqual(len(d["rows"]),241)
        self.assertAlmostEqual(d["errors"]["first_end"]["max_pp"],2.34246966923,places=8)
        self.assertLess(d["errors"]["last_end"]["max_pp"],1e-8)
        self.assertLess(d["errors"]["first_start"]["max_pp"],1e-8)
        for r in d["paper_table3_interior"]:
            for v,p in zip(r["hypotheses"]["first_start"],r["published"]):
                # Compare to displayed precision: 11.46, 9.958, 9806, 9358, 10.41, 10.91.
                rounding = 0.5 * 10**(math.floor(math.log10(abs(p)))-3)
                self.assertLessEqual(abs(v-p),rounding+1e-8)
            self.assertGreater(abs(r["hypotheses"]["last_end"][0]-r["published"][0]),.1)


REF=Path("/reference")
if __name__=="__main__":
    if len(sys.argv)>1:
        REF=Path(sys.argv.pop(1))
    unittest.main()
