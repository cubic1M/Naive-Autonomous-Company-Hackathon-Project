
from PIL import Image, ImageDraw, ImageFont
W,H=1920,1080; S={"x":740,"y":64,"w":440,"h":952}
im=Image.new('RGBA',(W,H),(251,250,246,255)); d=ImageDraw.Draw(im)
B=18; bx0,by0,bx1,by1=S['x']-B,S['y']-B,S['x']+S['w']+B,S['y']+S['h']+B
d.rounded_rectangle([bx0+6,by0+10,bx1+6,by1+14],62,fill=(40,50,44,60))
d.rounded_rectangle([bx0,by0,bx1,by1],62,fill=(20,26,22,255))
hole=Image.new('L',(W,H),0); ImageDraw.Draw(hole).rounded_rectangle([S['x'],S['y'],S['x']+S['w'],S['y']+S['h']],46,fill=255)
a=im.getchannel('A'); a=Image.composite(Image.new('L',(W,H),0),a,hole); im.putalpha(a)
d=ImageDraw.Draw(im)
f=lambda n,s: ImageFont.truetype('/home/user/Naive-Autonomous-Company-Hackathon-Project/video/capture/assets/'+n,s)
d.text((130,380),'THEIR SIDE OF THE SCREEN',font=ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf',22),fill=(70,102,79,255))
d.text((130,430),'An email, a tap,',font=f('InstrumentSerif-Regular.ttf',84),fill=(47,58,51,255))
d.text((130,520),'a paid job.',font=f('InstrumentSerif-Italic.ttf',84),fill=(70,102,79,255))
d.text((130,650),'Real pages, real taps.',font=ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Regular.otf',30),fill=(74,81,76,255))
d.text((130,694),'Invite, ID check, proof, payout.',font=ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Regular.otf',30),fill=(74,81,76,255))
im.save('/home/user/Naive-Autonomous-Company-Hackathon-Project/video/capture/.tmp/phone-frame.png')