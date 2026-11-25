import unittest
from cycle_audit import cycles,graph_report,synthetic,compare,dependencies,signature

class Tests(unittest.TestCase):
    def test_directed_cycles(self):
        nodes=set("abc")
        edges={(a,b) for a in nodes for b in nodes if a!=b}
        self.assertEqual(cycles(nodes,edges),{("a","b"),("a","c"),("b","c"),
                                             ("a","b","c"),("a","c","b")})
        self.assertNotEqual(signature(("a","b","c")),signature(("a","c","b")))

    def test_one_way(self):
        r=graph_report(synthetic(False))
        self.assertEqual(r["cycles"],[{"cycle":["fx","x"],"stock_partition":["x"]},
                                      {"cycle":["fy","y"],"stock_partition":["y"]}])
        self.assertIn(["x","fy"],r["edges"])

    def test_reciprocal(self):
        r=graph_report(synthetic(True))
        self.assertEqual({tuple(c["cycle"]) for c in r["cycles"]},
                         {("fx","x"),("fy","y"),("fx","x","fy","y")})
        self.assertTrue(all(c["stock_partition"]==["x","y"] for c in r["cycles"]))

    def test_partition_comparator(self):
        r=graph_report(synthetic(False))
        n={"ltm_mode":"exhaustive","loops":[{"cycle":["x","fx"],"partition":7},
                                          {"cycle":["y","fy"],"partition":3}]}
        self.assertTrue(compare(r,n)["same_partition_membership"])
        n["loops"][1]["partition"]=7
        self.assertFalse(compare(r,n)["same_partition_membership"])
        self.assertTrue(compare(r,n)["same_cycles"])

    def test_unsupported_syntax(self):
        self.assertEqual(dependencies("a*STEP(.05,1963)",{"a"}),{"a"})
        with self.assertRaises(ValueError):
            dependencies("a[1]",{"a"})
        with self.assertRaises(ValueError):
            dependencies("DELAY3(a,1,0)",{"a"})

if __name__=="__main__":
    unittest.main()
