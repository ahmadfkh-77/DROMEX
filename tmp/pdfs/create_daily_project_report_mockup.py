from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Flowable

OUTPUT=r"C:\Users\fakih\Desktop\Dromex\DROMEX\output\pdf\DROMEX-Daily-Project-Report-Sample.pdf"
W,H=A4
RED=colors.HexColor('#C84B31');RED_DARK=colors.HexColor('#8E2E1B');INK=colors.HexColor('#17212B');MUTED=colors.HexColor('#65717D')
LINE=colors.HexColor('#D9D5CE');SURFACE=colors.HexColor('#F8F6F1');GREEN=colors.HexColor('#26735B');GREEN_BG=colors.HexColor('#E5F3EC')
BLUE=colors.HexColor('#2E638A');BLUE_BG=colors.HexColor('#E7F1F8');ORANGE=colors.HexColor('#A66A13');ORANGE_BG=colors.HexColor('#FFF3D8')
PURPLE=colors.HexColor('#73518C');PURPLE_BG=colors.HexColor('#F0E9F5');RED_BG=colors.HexColor('#FCE8E6')

s=getSampleStyleSheet()
s.add(ParagraphStyle(name='TitleRight',parent=s['Title'],fontName='Helvetica-Bold',fontSize=21,leading=24,textColor=RED_DARK,alignment=TA_RIGHT))
s.add(ParagraphStyle(name='Section',parent=s['Heading2'],fontName='Helvetica-Bold',fontSize=12.5,leading=15,textColor=INK,spaceBefore=3*mm,spaceAfter=1.5*mm))
s.add(ParagraphStyle(name='Sub',parent=s['Heading3'],fontName='Helvetica-Bold',fontSize=10.5,leading=13,textColor=INK))
s.add(ParagraphStyle(name='BodySmall',parent=s['BodyText'],fontName='Helvetica',fontSize=8.2,leading=11.2,textColor=INK))
s.add(ParagraphStyle(name='Muted',parent=s['BodyText'],fontName='Helvetica',fontSize=7.5,leading=10,textColor=MUTED))
s.add(ParagraphStyle(name='CardValue',parent=s['BodyText'],fontName='Helvetica-Bold',fontSize=16,leading=18,textColor=INK))
s.add(ParagraphStyle(name='CardLabel',parent=s['BodyText'],fontName='Helvetica-Bold',fontSize=7.7,leading=9.5,textColor=INK))
s.add(ParagraphStyle(name='RightSmall',parent=s['BodyText'],fontName='Helvetica',fontSize=7.5,leading=10,textColor=MUTED,alignment=TA_RIGHT))

def p(v,style='BodySmall'):return Paragraph(str(v),s[style])

def header_footer(c,doc):
    c.saveState();c.setFillColor(INK);c.setFont('Helvetica-Bold',11);c.drawString(14*mm,H-12*mm,'DROMEX')
    c.setFillColor(RED);c.rect(14*mm,H-15*mm,30*mm,1.4*mm,fill=1,stroke=0)
    c.setFillColor(MUTED);c.setFont('Helvetica',7);c.drawRightString(W-14*mm,H-11.5*mm,'Daily Project Report  |  06 May 2026')
    c.setStrokeColor(LINE);c.line(14*mm,12*mm,W-14*mm,12*mm);c.setFont('Helvetica',7);c.setFillColor(MUTED)
    c.drawString(14*mm,7.5*mm,'Ain Qana Roadworks  |  Generated offline from saved project records');c.drawRightString(W-14*mm,7.5*mm,f'Page {doc.page} of 2');c.restoreState()

def card(value,label,note,bg,accent):
    return Table([[p(value,'CardValue')],[p(label,'CardLabel')],[p(note,'Muted')]],colWidths=[42.5*mm],rowHeights=[8*mm,5*mm,8*mm],style=TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),bg),('BOX',(0,0),(-1,-1),.5,accent),('LINEBEFORE',(0,0),(0,-1),3,accent),
        ('LEFTPADDING',(0,0),(-1,-1),4*mm),('RIGHTPADDING',(0,0),(-1,-1),2.5*mm),('TOPPADDING',(0,0),(-1,-1),1.3*mm),('BOTTOMPADDING',(0,0),(-1,-1),1*mm)]))

def data_table(headers,rows,widths,header_bg=colors.HexColor('#EEEAE2'),font=7.2):
    vals=[[p(h,'CardLabel') for h in headers]]+[[p(v) for v in row] for row in rows]
    return Table(vals,colWidths=widths,repeatRows=1,style=TableStyle([
        ('BACKGROUND',(0,0),(-1,0),header_bg),('GRID',(0,0),(-1,-1),.35,LINE),('VALIGN',(0,0),(-1,-1),'TOP'),
        ('FONTSIZE',(0,0),(-1,-1),font),('LEFTPADDING',(0,0),(-1,-1),2.2*mm),('RIGHTPADDING',(0,0),(-1,-1),2.2*mm),('TOPPADDING',(0,0),(-1,-1),1.5*mm),('BOTTOMPADDING',(0,0),(-1,-1),1.5*mm)]))

def info_panel(title,body,bg,accent,width):
    return Table([[p(title,'Sub')],[p(body)]],colWidths=[width],style=TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),bg),('BOX',(0,0),(-1,-1),.5,accent),('LINEBEFORE',(0,0),(0,-1),3,accent),
        ('LEFTPADDING',(0,0),(-1,-1),4*mm),('RIGHTPADDING',(0,0),(-1,-1),3*mm),('TOPPADDING',(0,0),(-1,-1),2.2*mm),('BOTTOMPADDING',(0,0),(-1,-1),2.2*mm)]))

class PhotoRow(Flowable):
    def __init__(self,width=175*mm,height=54*mm):super().__init__();self.width=width;self.height=height
    def draw(self):
        c=self.canv;gap=5*mm;cw=(self.width-gap)/2
        for i,(title,time) in enumerate([('Subbase placement and grading','10:18'),('Density testing after compaction','15:42')]):
            x=i*(cw+gap);c.setFillColor(colors.HexColor('#E8E5DF'));c.roundRect(x,0,cw,self.height,2*mm,fill=1,stroke=0)
            c.setStrokeColor(colors.HexColor('#B9B3AA'));c.line(x+6*mm,7*mm,x+cw-6*mm,self.height-7*mm);c.line(x+cw-6*mm,7*mm,x+6*mm,self.height-7*mm)
            c.setFillColor(INK);c.setFont('Helvetica-Bold',7.5);c.drawString(x+3*mm,4*mm,title);c.setFillColor(MUTED);c.setFont('Helvetica',7);c.drawRightString(x+cw-3*mm,4*mm,time)

doc=BaseDocTemplate(OUTPUT,pagesize=A4,rightMargin=14*mm,leftMargin=14*mm,topMargin=22*mm,bottomMargin=16*mm,title='DROMEX Daily Project Report Sample')
frame=Frame(doc.leftMargin,doc.bottomMargin,doc.width,doc.height,id='main');doc.addPageTemplates(PageTemplate(id='daily',frames=frame,onPage=header_footer))
story=[]

# PAGE 1
story += [Spacer(1,4*mm),Table([[p('PROJECT OPERATIONS','Muted'),p('Daily Project Report','TitleRight')],[p('<b>Ain Qana Roadworks</b>','Sub'),p('Wednesday, 06 May 2026','RightSmall')],[p('Ain Qana Municipality  |  Ain Qana, Mount Lebanon','Muted'),p('Report status: SAVED','RightSmall')]],colWidths=[80*mm,98*mm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])),Spacer(1,4*mm)]
story.append(Table([[card('10.0 h','NET WORKING TIME','06:30 to 18:00; 90 min break',GREEN_BG,GREEN),card('7','LOADS DELIVERED','122.500 m3 total',BLUE_BG,BLUE),card('5','WASTE DUMPS','3 soil; 2 mixed material',ORANGE_BG,ORANGE),card('4','PHOTOS','Saved with this report',PURPLE_BG,PURPLE)]],colWidths=[44.5*mm]*4,style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),1*mm),('RIGHTPADDING',(0,0),(-1,-1),1*mm)])))
story += [p('Work performed today','Section'),info_panel('Subbase placement and compaction','Placed imported crushed subbase from chainage 1+250 to 1+610 in two controlled layers. Grader trimmed levels, water truck maintained moisture, and the roller completed the specified passes. Three field-density tests were completed and recorded as passing.',BLUE_BG,BLUE,175*mm)]
story += [p('Time and site conditions','Section'),Table([[info_panel('Working time','Start 06:30  |  End 18:00  |  Break 90 minutes  |  <b>Net 10 hours</b>',GREEN_BG,GREEN,85*mm),info_panel('Weather and site','Hot and dry. Dust increased after midday; continuous water-truck operation kept the haul route and formation controlled.',ORANGE_BG,ORANGE,85*mm)]],colWidths=[87.5*mm,87.5*mm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),1*mm),('RIGHTPADDING',(0,0),(-1,-1),1*mm)]))]
story += [p('People and equipment','Section'),data_table(['Section','Count','Present today'],[
    ['Workers','11','Foreman; surveyor; 2 grader assistants; 2 roller assistants; 5 general workers'],
    ['Drivers','4','Omar Khalil; Hassan Ali; Rami Nassar; Ahmad Saleh'],
    ['Trucks','5','B 456321; M 221847; G 774190; T 118430; N 903215'],
    ['Machines','4','Volvo grader G930; Hamm roller HD110; Volvo loader L120; Water Truck WT-01'],
],[32*mm,20*mm,123*mm],BLUE_BG)]
story += [p('Materials used or transported','Section'),data_table(['Movement','Material','Quantity','Unit','Site note'],[
    ['Used','Crushed subbase 0-63 mm','122.500','m3','Placed in two compacted layers'],
    ['Used','Water for compaction','18,000','L','Moisture conditioning and dust control'],
    ['Transported','Suitable excavated fill','42.000','m3','Moved to stockpile B for later reuse'],
],[29*mm,53*mm,27*mm,18*mm,48*mm],GREEN_BG)]
story.append(PageBreak())

# PAGE 2
story += [p('Deliveries, waste, and site notes','TitleRight'),p('Automatically linked operational records are read-only in the daily report. Corrections are made in their original Load History or Waste Dump record.', 'Muted'),Spacer(1,3*mm)]
story += [p('Loads delivered that day','Section'),data_table(['Transaction','Item','Quantity','Driver','Truck'],[
    ['20260506-DX1-00312','Crushed subbase 0-63 mm','17.500 m3','Omar Khalil','B 456321'],
    ['20260506-DX1-00313','Crushed subbase 0-63 mm','18.000 m3','Hassan Ali','M 221847'],
    ['20260506-DX1-00314','Crushed subbase 0-63 mm','17.250 m3','Rami Nassar','G 774190'],
    ['20260506-DX1-00315','Crushed subbase 0-63 mm','17.750 m3','Ahmad Saleh','T 118430'],
    ['20260506-DX1-00316','Crushed subbase 0-63 mm','18.000 m3','Omar Khalil','B 456321'],
    ['20260506-DX1-00317','Crushed subbase 0-63 mm','17.000 m3','Hassan Ali','M 221847'],
    ['20260506-DX1-00318','Crushed subbase 0-63 mm','17.000 m3','Rami Nassar','G 774190'],
],[43*mm,54*mm,27*mm,29*mm,23*mm],BLUE_BG,6.7)]
story += [p('Waste dumps completed that day','Section'),Table([[card('5','TOTAL DUMPS','All active records',ORANGE_BG,ORANGE),data_table(['Material','Dump location','Dumps'],[['Excavated soil','Municipal approved dump','3'],['Mixed unsuitable material','North quarry disposal area','2']],[45*mm,62*mm,22*mm],ORANGE_BG)]],colWidths=[45*mm,130*mm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),1*mm),('RIGHTPADDING',(0,0),(-1,-1),1*mm)]))]
story += [p('Site notes and follow-up','Section'),Table([[info_panel('General notes','Survey levels and density-test results were accepted for today\'s completed area. Haul access remained open throughout the shift.',SURFACE,BLUE,85*mm),info_panel('Problems, delays, or incidents','No safety incident. One delivery arrived 25 minutes late; work continued using material already on site.',RED_BG,RED,85*mm)],[info_panel('Next work planned','Continue subbase placement to chainage 1+800. Complete edge trimming and arrange three additional density tests.',GREEN_BG,GREEN,85*mm),info_panel('Daily close-out','Formation left safe and stable. Equipment parked in the designated area. No open urgent action at report close.',PURPLE_BG,PURPLE,85*mm)]],colWidths=[87.5*mm,87.5*mm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),1*mm),('RIGHTPADDING',(0,0),(-1,-1),1*mm),('TOPPADDING',(0,0),(-1,-1),1*mm),('BOTTOMPADDING',(0,0),(-1,-1),1*mm)]))]
story += [p('Photo evidence','Section'),p('Photos remain attached to the daily report. The actual export uses the saved images with their sequence and work date.', 'Muted'),Spacer(1,2*mm),PhotoRow(),Spacer(1,4*mm)]
doc.build(story)
print(OUTPUT)
