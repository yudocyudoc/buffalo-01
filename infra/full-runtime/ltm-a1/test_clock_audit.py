import math
import unittest
import xml.etree.ElementTree as ET
from clock_audit import advance,clock_rows,scores,delay_rows,clock_xml,delay_xml,compare_clock,sampling_pair,DT


class Tests(unittest.TestCase):
    def test_integrators(self):
        f=lambda t,s:(s[0],)
        self.assertEqual(advance(f,0,(1.,),.25,"Euler"),(1.25,))
        self.assertAlmostEqual(advance(f,0,(1.,),.25,"RK4")[0],1+.25+.25**2/2+.25**3/6+.25**4/24)
        self.assertNotEqual(clock_rows("Euler")[-1],clock_rows("RK4")[-1])

    def test_clock_intervals_discriminate(self):
        for m in ("Euler","RK4"):
            r=clock_rows(m)
            self.assertEqual(len(r),17)
            self.assertGreater(max(abs(a-b) for a,b in zip(scores(r,4,1),scores(r,4,4))),.01)

    def test_delay_initial_and_material(self):
        r=delay_rows("Euler")
        self.assertEqual(r[0]["output_rate"],2)
        self.assertEqual(r[1]["a"],2)
        self.assertEqual(r[2]["a"],2.0625)
        self.assertEqual(r[3]["b"],2.015625)
        self.assertEqual(r[4]["output_rate"],2.00390625)
        self.assertGreater(delay_rows("RK4")[1]["output_rate"],2)

    def test_xml_save_interval(self):
        ns={"x":"http://docs.oasis-open.org/xmile/ns/XMILE/v1.0"}
        spec=ET.fromstring(clock_xml("RK4",1)).find("x:sim_specs",ns)
        self.assertEqual(spec.get("method"),"RK4")
        self.assertEqual(spec.get("{http://iseesystems.com/XMILE}save_interval"),"1")
        self.assertIn(b"DELAY3(input_rate,3,2)",delay_xml("Euler",True))
        self.assertNotIn(b"DELAY3",delay_xml("Euler",False))

    def test_comparator_and_negative(self):
        rows=clock_rows("Euler")
        def fixture(stride):
            idx=list(range(0,len(rows),stride))
            return {"time":[rows[i]["time"] for i in idx],
                    "trajectory":{k:[rows[i][k] for i in idx] for k in ("x","y","z")},
                    "links":[{"from":s,"to":"z","raw":[0]+[scores(rows,i,1)[j] for i in idx[1:]]}
                             for j,s in enumerate(("x","y"))]}
        a=compare_clock(fixture(1),"Euler",DT)
        b=compare_clock(fixture(4),"Euler",1.)
        self.assertEqual(a["score_max_error"]["integration_interval"],0)
        self.assertGreater(b["score_max_error"]["saved_interval"],.01)
        self.assertEqual(sampling_pair(a,b)["max_raw_error_at_shared_times"],0)
        bad=fixture(4)
        bad["links"][1]["raw"]=None
        with self.assertRaisesRegex(ValueError,"missing raw score"):
            compare_clock(bad,"Euler",1.)

if __name__=="__main__":
    unittest.main()
