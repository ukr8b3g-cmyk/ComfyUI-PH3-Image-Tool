import unittest
import numpy as np
from PIL import Image
from support import processing

class RegionTests(unittest.TestCase):
 def test_add_restore_and_reset_preserve_original_alpha(self):
  a=np.full((20,30,4),255,np.uint8);a[:,10:20,:3]=0;a[0,0,3]=0
  image=Image.fromarray(a);before=image.tobytes()
  regions=[{'seed':[3,5],'remove':True},{'seed':[25,5],'remove':True}]
  out=processing.color_cutout(image,0,regions=regions)
  self.assertEqual(out.getpixel((3,5))[3],0);self.assertEqual(out.getpixel((25,5))[3],0);self.assertEqual(out.getpixel((15,5))[3],255)
  out=processing.color_cutout(image,0,regions=regions+[{'seed':[3,5],'remove':False}])
  self.assertEqual(out.getpixel((3,5))[3],255);self.assertEqual(out.getpixel((25,5))[3],0);self.assertEqual(out.getpixel((0,0))[3],0)
  self.assertEqual(processing.color_cutout(image,regions=[]).tobytes(),before);self.assertEqual(image.tobytes(),before)
 def test_invalid_region_is_rejected(self):
  for regions in [[{'seed':[-1,0],'remove':True}],[{'seed':[0,0],'remove':'yes'}],[{}]*65]:
   with self.assertRaises(ValueError):processing.color_cutout(Image.new('RGBA',(10,10)),regions=regions)
