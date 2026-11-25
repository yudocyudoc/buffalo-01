import unittest
from system_change import system_change,example,native_net,compare


class Tests(unittest.TestCase):
    def test_hand_calculation(self):
        r=example()
        self.assertEqual(r["accumulated"],{"x":4,"y":3,"static":0})
        self.assertEqual(r["raw"],[0,.5,1,.5])
        self.assertEqual(r["normalized"],[0,.5,1,.5])
        self.assertEqual(r["zero_change_stocks"],["static"])

    def test_units_and_sign(self):
        self.assertEqual(example(1000)["normalized"],example()["normalized"])
        self.assertEqual(example(-1)["normalized"],example()["normalized"])

    def test_all_static(self):
        r=system_change([0,1],{"a":[0,0],"b":[0,0]})
        self.assertEqual(r["normalized"],[0,0])
        self.assertEqual(r["peak"],0)

    def test_window_dependence(self):
        a=system_change([0,1,2],{"x":[1,2,0],"y":[0,1,2]})
        b=system_change([0,1,2,3],{"x":[1,2,0,10],"y":[0,1,2,0]})
        self.assertNotEqual(a["normalized"],b["normalized"][:3])
        self.assertAlmostEqual(sum(a["raw"]),2)

    def test_net_not_throughput(self):
        n={"time":[0,1],"trajectory":{"s":[10,10],"i":[5,5],"o":[5,5]}}
        r=native_net(n,{"s":[("i",1),("o",-1)]})
        self.assertEqual(r["normalized"],[0,0])
        self.assertTrue(compare(r,system_change([0,1],{"s":[0,0]}))["matches_metric"])

    def test_reject_incomplete(self):
        for t,v in [([0,1,3],[1,2,3]),([0,1],[1]),([0,1],[1,float("nan")]),([0,0],[1,2])]:
            with self.assertRaises(ValueError):
                system_change(t,{"x":v})

    def test_stock_duplication_not_invariant(self):
        a=example()
        b=system_change(a["time"],{**a["net_flows"],"copy_x":a["net_flows"]["x"]})
        self.assertNotEqual(a["normalized"],b["normalized"])

if __name__=="__main__":
    unittest.main()
