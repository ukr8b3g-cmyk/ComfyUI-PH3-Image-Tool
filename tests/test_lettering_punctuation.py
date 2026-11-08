import unittest
from support import load
l=load('lettering')
class PunctuationTests(unittest.TestCase):
 def test_vertical_two_marks_has_four_rows_and_explicit_count(self):
  p=l.prompt(l.options(dict(text='ビクッ!!',vertical=True)))
  self.assertIn('exactly 4 rows',p);self.assertIn('2 punctuation symbols in total',p);self.assertIn('exactly two stems and exactly two dots',p)
 def test_counts_follow_input_not_hard_coded_pair(self):
  for text,expected in [('ドン！','1 exclamation mark(s)'),('え!?','1 question mark(s)'),('ドン!!!','3 exclamation mark(s)')]:
   self.assertIn(expected,l.prompt(l.options(dict(text=text,vertical=True))))
 def test_horizontal_has_no_vertical_count_plan(self):
  self.assertNotIn('FINAL-ROW COUNT',l.prompt(l.options(dict(text='ビクッ!!'))))
 def test_pop_detaches_dakuten_in_t2i_and_candidate_decoration_modes(self):
  for preset in ['angular','pop','round']:
   for reference in [False,True]:
    opts=l.options(dict(text='ビクッ!!',preset=preset,style='pop',decoration='spiky' if reference else 'none',use_reference=reference,reference_kind='candidate'))
    p=l.prompt(opts)
    self.assertIn('"ビクッ!!"',p)
    if reference:
     self.assertTrue(p.startswith('Edit <Picture 1>.'));self.assertIn('Add a spiky speech bubble',p.splitlines()[0]);self.assertIn('central 70 percent',p);self.assertIn('detached from the main body and from each other',p);self.assertNotIn('DETACHED DAKUTEN:',p)
    else:
     self.assertIn('three disconnected black shapes',p);self.assertIn('higher than the highest edge of the kana body',p);self.assertIn('Never attach, bridge, fuse or overlap',p)
 def test_detachment_priority_only_applies_to_pop_t2i_with_voiced_kana(self):
  p=l.prompt(l.options(dict(text='ビクッ!!',style='pop')));self.assertTrue(p.startswith('PRIORITY:'));self.assertIn('farther UP and RIGHT',p)
  for opts in [dict(text='キャッ!!',style='pop'),dict(text='ビクッ!!',style='cute'),dict(text='ビクッ!!',style='pop',use_reference=True,reference_kind='candidate',decoration='spiky')]:self.assertFalse(l.prompt(l.options(opts)).startswith('PRIORITY:'))
  self.assertTrue(l.prompt(l.options(dict(text='ヒ\u3099クッ!!',style='pop'))).startswith('PRIORITY:'))
if __name__=='__main__':unittest.main()
