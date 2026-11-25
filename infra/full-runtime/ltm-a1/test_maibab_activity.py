import unittest
from maibab_activity import zero_series,edit_once,short_copy,reference_group_diagnostic
from clock_audit import header

class Tests(unittest.TestCase):
    def test_zero_requires_complete_observation(self):
        self.assertTrue(zero_series([0.,-0.],2))
        for bad in (None,[0],[0,None],[0,float("nan")],[0,1e-300]):
            self.assertFalse(zero_series(bad,2))

    def test_edit_receipt(self):
        raw=b'<eqn>1</eqn>'
        new,receipt=edit_once(raw,rb'<eqn>(1)</eqn>',b'100')
        self.assertEqual(new,b'<eqn>100</eqn>')
        self.assertEqual(receipt["old"],"1")
        with self.assertRaises(ValueError):
            edit_once(raw+raw,rb'<eqn>(1)</eqn>',b'100')

    def test_paired_copy(self):
        raw=header("RK4",.125,'<aux name="Normal Food Per Deer"><eqn>1</eqn></aux>').replace(b'<stop>4</stop>',b'<stop>2300</stop>')
        a,ar=short_copy(raw,False)
        b,br=short_copy(raw,True)
        self.assertEqual(len(ar),1)
        self.assertEqual(len(br),2)
        self.assertEqual(b,a.replace(b'<eqn>1</eqn>',b'<eqn>100</eqn>'))

    def test_group_renormalization(self):
        native={"time":[1810,1811],"loops":[{"cycle":["a"],"relative":[0,.75]},
                                            {"cycle":["b"],"relative":[0,-.25]}]}
        ref={("a",):{"group":"g1","scores":[0,100]},("b",):{"group":"g2","scores":[0,100]}}
        d=reference_group_diagnostic(native,[1810,1811],ref)
        self.assertEqual(d["g1"]["at_1811"]["share_of_native_total"],.75)
        self.assertEqual(d["g2"]["max_error_pp"],0)

if __name__=="__main__":
    unittest.main()
