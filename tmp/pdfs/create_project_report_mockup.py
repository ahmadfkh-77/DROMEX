from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Flowable

OUTPUT = r"C:\Users\fakih\Desktop\Dromex\DROMEX\output\pdf\DROMEX-Completed-Project-Report-Sample.pdf"
W,H=A4
BRAND=colors.HexColor('#C84B31'); DARK=colors.HexColor('#8E2E1B'); INK=colors.HexColor('#17212B')
MUTED=colors.HexColor('#65717D'); PALE=colors.HexColor('#F5F2EC'); LINE=colors.HexColor('#D9D5CE')
GREEN=colors.HexColor('#26735B'); AMBER=colors.HexColor('#A66A13'); RED_PALE=colors.HexColor('#FCE8E6')

s=getSampleStyleSheet()
s.add(ParagraphStyle(name='ReportTitle',parent=s['Title'],fontName='Helvetica-Bold',fontSize=21,leading=24,textColor=DARK,alignment=TA_RIGHT,spaceAfter=2*mm))
s.add(ParagraphStyle(name='Section',parent=s['Heading2'],fontName='Helvetica-Bold',fontSize=13,leading=16,textColor=DARK,spaceBefore=3*mm,spaceAfter=2*mm))
s.add(ParagraphStyle(name='Sub',parent=s['Heading3'],fontName='Helvetica-Bold',fontSize=10.5,leading=13,textColor=INK,spaceBefore=1.5*mm,spaceAfter=1*mm))
s.add(ParagraphStyle(name='BodySmall',parent=s['BodyText'],fontName='Helvetica',fontSize=8.2,leading=11.2,textColor=INK))
s.add(ParagraphStyle(name='Muted',parent=s['BodyText'],fontName='Helvetica',fontSize=7.5,leading=10.5,textColor=MUTED))
s.add(ParagraphStyle(name='MetricValue',parent=s['BodyText'],fontName='Helvetica-Bold',fontSize=16,leading=18,textColor=DARK))
s.add(ParagraphStyle(name='MetricLabel',parent=s['BodyText'],fontName='Helvetica',fontSize=7.2,leading=9,textColor=MUTED))
s.add(ParagraphStyle(name='RightSmall',parent=s['BodyText'],fontName='Helvetica',fontSize=7.5,leading=10,textColor=MUTED,alignment=TA_RIGHT))

def p(v,style='BodySmall'): return Paragraph(str(v),s[style])

def header_footer(c,doc):
    c.saveState(); c.setFillColor(INK); c.setFont('Helvetica-Bold',11); c.drawString(14*mm,H-12*mm,'DROMEX')
    c.setFillColor(BRAND); c.rect(14*mm,H-15*mm,30*mm,1.4*mm,fill=1,stroke=0)
    c.setFillColor(MUTED); c.setFont('Helvetica',7); c.drawRightString(W-14*mm,H-11.5*mm,'Completed Project Report  |  SAMPLE LAYOUT')
    c.setStrokeColor(LINE); c.line(14*mm,12*mm,W-14*mm,12*mm); c.setFont('Helvetica',7); c.setFillColor(MUTED)
    c.drawString(14*mm,7.5*mm,'Generated offline from project records  |  Cancelled entries excluded from active totals')
    c.drawRightString(W-14*mm,7.5*mm,f'Page {doc.page}'); c.restoreState()

def metric(value,label,note=''):
    return Table([[p(value,'MetricValue')],[p(label,'MetricLabel')],[p(note,'Muted')]],colWidths=[52*mm],rowHeights=[8*mm,5*mm,8*mm],style=TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),.5,LINE),('LEFTPADDING',(0,0),(-1,-1),4*mm),('RIGHTPADDING',(0,0),(-1,-1),3*mm),('TOPPADDING',(0,0),(-1,-1),1.5*mm),('BOTTOMPADDING',(0,0),(-1,-1),1*mm)]))

def table(headers,rows,widths,aligns=None,font=7.2):
    vals=[[p(h,'Muted') for h in headers]]+[[p(v) for v in row] for row in rows]
    cmds=[('BACKGROUND',(0,0),(-1,0),PALE),('GRID',(0,0),(-1,-1),.35,LINE),('VALIGN',(0,0),(-1,-1),'TOP'),('FONTSIZE',(0,0),(-1,-1),font),('LEFTPADDING',(0,0),(-1,-1),2*mm),('RIGHTPADDING',(0,0),(-1,-1),2*mm),('TOPPADDING',(0,0),(-1,-1),1.5*mm),('BOTTOMPADDING',(0,0),(-1,-1),1.5*mm)]
    for i,a in enumerate(aligns or []): cmds.append(('ALIGN',(i,1),(i,-1),a))
    return Table(vals,colWidths=widths,repeatRows=1,style=TableStyle(cmds))

class ProgressBar(Flowable):
    def __init__(self,value=100,width=175*mm,height=11*mm): super().__init__(); self.value=value; self.width=width; self.height=height
    def draw(self):
        c=self.canv;c.setFillColor(PALE);c.roundRect(0,3*mm,self.width,5*mm,2*mm,fill=1,stroke=0);c.setFillColor(GREEN);c.roundRect(0,3*mm,self.width*self.value/100,5*mm,2*mm,fill=1,stroke=0);c.setFillColor(INK);c.setFont('Helvetica-Bold',8);c.drawRightString(self.width,0,f'{self.value}% completed')

class PhotoGrid(Flowable):
    def __init__(self,width=175*mm,height=38*mm): super().__init__();self.width=width;self.height=height
    def draw(self):
        c=self.canv;gap=5*mm;cw=(self.width-gap)/2;ch=self.height
        labels=[('Excavation - Month 1','02 Feb 2026'),('Completed road section','28 Jul 2026')]
        for i,(title,date) in enumerate(labels):
            col=i%2;x=col*(cw+gap);y=0
            c.setFillColor(colors.HexColor('#E8E5DF'));c.roundRect(x,y,cw,ch,2*mm,fill=1,stroke=0)
            c.setStrokeColor(colors.HexColor('#B9B3AA'));c.line(x+5*mm,y+6*mm,x+cw-5*mm,y+ch-6*mm);c.line(x+cw-5*mm,y+6*mm,x+5*mm,y+ch-6*mm)
            c.setFillColor(INK);c.setFont('Helvetica-Bold',7.5);c.drawString(x+3*mm,y+4*mm,title)
            c.setFillColor(MUTED);c.setFont('Helvetica',7);c.drawRightString(x+cw-3*mm,y+4*mm,date)

doc=BaseDocTemplate(OUTPUT,pagesize=A4,rightMargin=14*mm,leftMargin=14*mm,topMargin=22*mm,bottomMargin=16*mm,title='DROMEX Completed Project Report Sample')
frame=Frame(doc.leftMargin,doc.bottomMargin,doc.width,doc.height,id='main');doc.addPageTemplates(PageTemplate(id='project',frames=frame,onPage=header_footer))
story=[]

# Page 1 - overall completion summary
story += [Spacer(1,4*mm),Table([[p('DROMEX SAL','Sub'),p('Completed Project Report','ReportTitle')],[p('Main Plant - Lebanon','Muted'),p('Ain Qana Roadworks  |  Final', 'RightSmall')]],colWidths=[75*mm,103*mm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])),Spacer(1,4*mm)]
story += [Table([[p('Project','Muted'),p('Ain Qana Roadworks')],[p('Customer','Muted'),p('Ain Qana Municipality')],[p('Location','Muted'),p('Ain Qana, Mount Lebanon')],[p('Recorded duration','Muted'),p('01 February 2026 to 31 July 2026')],[p('Status','Muted'),p('<b>Completed</b> - 31 July 2026')]],colWidths=[42*mm,133*mm],style=TableStyle([('BOX',(0,0),(-1,-1),.5,LINE),('INNERGRID',(0,0),(-1,-1),.35,LINE),('BACKGROUND',(0,0),(0,-1),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),3*mm),('RIGHTPADDING',(0,0),(-1,-1),3*mm),('TOPPADDING',(0,0),(-1,-1),2*mm),('BOTTOMPADDING',(0,0),(-1,-1),2*mm)])),Spacer(1,3*mm),ProgressBar(),Spacer(1,3*mm)]
story.append(Table([[metric('118','Daily reports','118 recorded working days'),metric('426','Delivered loads','Project-linked confirmed loads'),metric('164','Waste dumps','Active completed dumps')],[metric('1,062.5 h','Recorded work time','Net of daily breaks'),metric('286','Project photos','Attached to daily reports'),metric('9','Issue days','Delays or incidents recorded')]],colWidths=[58.5*mm]*3,style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),1*mm),('RIGHTPADDING',(0,0),(-1,-1),1*mm),('TOPPADDING',(0,0),(-1,-1),1.2*mm),('BOTTOMPADDING',(0,0),(-1,-1),1.2*mm)])))
story += [p('Executive summary','Section'),p('The six-month project included site clearing, bulk excavation, unsuitable-material disposal, drainage installation, imported subbase and basecourse placement, grading, compaction, and final handover preparation. Work progressed through winter rain interruptions and one equipment-breakdown delay. All recorded works were completed, open issues were closed, and the final project status was set to Completed.'),p('Phase summary','Section')]
story.append(table(['Phase','Period','Primary work','Recorded outcome'],[
    ['Mobilization and clearing','Feb 2026','Survey setting-out, vegetation removal, access preparation','Completed'],
    ['Excavation and waste removal','Feb-Apr 2026','Cut excavation, rock breaking, soil and vegetation dumps','Completed'],
    ['Drainage and formation','Mar-May 2026','Culverts, side drains, formation trimming and testing','Completed'],
    ['Subbase and basecourse','May-Jun 2026','Imported material, grading, watering and compaction','Completed'],
    ['Finishing and handover','Jul 2026','Shoulders, cleaning, snag correction, final inspection','Completed'],
],[35*mm,27*mm,76*mm,37*mm]))
story += [p('Project completion notes','Section'),Table([[p('Final condition','Muted'),p('All recorded construction activities completed. Site cleared and access maintained for handover.')],[p('Outstanding work','Muted'),p('None recorded at project completion. Final quantities remain subject to signed commercial measurement certificates outside this operational report.')]],colWidths=[38*mm,137*mm],style=TableStyle([('BOX',(0,0),(-1,-1),.5,LINE),('INNERGRID',(0,0),(-1,-1),.35,LINE),('BACKGROUND',(0,0),(0,-1),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),3*mm),('RIGHTPADDING',(0,0),(-1,-1),3*mm),('TOPPADDING',(0,0),(-1,-1),2*mm),('BOTTOMPADDING',(0,0),(-1,-1),2*mm)])),PageBreak()]

# Page 2 - daily work timeline
story += [p('Daily work timeline','ReportTitle'),p('The final PDF contains every saved daily report. This sample page shows representative days across the six-month project; the actual export continues across additional pages as needed.', 'Muted'),Spacer(1,3*mm)]
story.append(table(['Work date','Work performed','People / equipment','Working time','Conditions / issues','Next work'],[
    ['02 Feb 2026','Mobilized excavator and loader; cleared vegetation along chainage 0+000 to 0+240.','8 workers; CAT 320; Volvo L120; 3 trucks','07:00-16:30; 60 min break; 8.5 h','Cloudy; soft ground. No incident.','Continue clearing and begin topsoil stripping.'],
    ['18 Feb 2026','Bulk excavation and loading of unsuitable soil for off-site disposal.','10 workers; CAT 320; 5 trucks; dozer','06:45-17:15; 75 min break; 9.25 h','Light rain caused 45-minute delay.','Resume excavation after access inspection.'],
    ['18 Mar 2026','Installed first culvert section and prepared headwall foundation.','12 workers; crane; excavator; mixer','07:10-17:30; 60 min break; 9.33 h','Dry; safe lifting operation completed.','Cast headwalls and backfill culvert.'],
    ['06 May 2026','Placed and compacted imported subbase in two layers. Field density tests passed.','11 workers; grader; roller; water truck','06:30-18:00; 90 min break; 10.0 h','Hot and dusty; water truck used continuously.','Continue subbase to chainage 1+800.'],
    ['22 Jun 2026','Basecourse spreading and final grading. Loader hydraulic hose failed.','9 workers; grader; roller; loader','07:00-15:40; 60 min break; 7.67 h','Equipment breakdown caused 2-hour delay.','Repair loader and complete grading.'],
    ['28 Jul 2026','Final shoulder dressing, site cleaning, and joint inspection with municipality.','7 workers; loader; water truck','07:30-15:30; 60 min break; 7.0 h','Clear weather. Minor snag at culvert outlet.','Correct snag and prepare completion.'],
],[22*mm,47*mm,36*mm,29*mm,34*mm,35*mm],font=6.2))
story += [p('Recorded time by month','Section'),table(['Month','Report days','Gross hours','Break hours','Net recorded hours','Issue days'],[
    ['February','20','191.0','21.5','169.5','3'],['March','22','207.5','23.0','184.5','2'],['April','19','181.0','20.0','161.0','1'],['May','21','214.0','25.0','189.0','1'],['June','20','198.5','22.0','176.5','2'],['July','16','199.0','17.0','182.0','0'],['Total','118','1,191.0','128.5','1,062.5','9']],[32*mm,26*mm,29*mm,29*mm,35*mm,24*mm],['LEFT','RIGHT','RIGHT','RIGHT','RIGHT','RIGHT'])]
story += [p('Problems, delays, and incidents summary','Section'),table(['Date','Type','Recorded event','Effect / resolution'],[
    ['18 Feb','Weather delay','Rain softened access road and paused hauling.','45-minute delay; access graded before work resumed.'],['09 Mar','Safety observation','Pedestrian entered truck route.','Work paused; banksman and barrier position corrected.'],['22 Jun','Equipment breakdown','Loader hydraulic hose failed during basecourse work.','Two-hour delay; hose replaced and loader returned to service.'],['28 Jul','Quality snag','Minor erosion at culvert outlet found during inspection.','Stone protection added before project completion.']],[25*mm,31*mm,62*mm,57*mm])]
story.append(PageBreak())

# Page 3 - materials and loads
story += [p('Materials and delivered loads','ReportTitle'),p('Unlike units are never combined. Delivered loads come directly from project-linked confirmed loads; daily-report materials remain a separate record of what the site reported as used or transported.', 'Muted'),Spacer(1,3*mm)]
story += [p('Delivered-load summary','Section'),table(['Delivered item','Loads','Unit','Total quantity','First delivery','Last delivery'],[
    ['Crushed subbase 0-63 mm','168','m3','2,940.000','04 Apr 2026','24 May 2026'],['Basecourse 0-31.5 mm','142','m3','2,485.500','18 May 2026','18 Jul 2026'],['Selected fill','76','m3','1,330.000','12 Mar 2026','09 May 2026'],['Rock armour','24','t','412.800','10 Jun 2026','29 Jul 2026'],['Ready-mix concrete','16','m3','128.000','18 Mar 2026','14 Apr 2026'],['Total project-linked loads','426','Separate by unit','-','12 Mar 2026','29 Jul 2026']],[49*mm,20*mm,22*mm,30*mm,29*mm,29*mm],['LEFT','RIGHT','LEFT','RIGHT','LEFT','LEFT'])]
story += [p('Daily-report material summary','Section'),table(['Movement','Material','Unit','Reported quantity','Report days'],[
    ['Used','Geotextile','m2','8,450.0','12'],['Used','Drainage pipe 600 mm','m','428.0','9'],['Used','Cement','bags','1,180','17'],['Used','Diesel for site generator','L','2,105.0','24'],['Transported','Excavated suitable fill','m3','3,240.0','38'],['Transported','Rock for reuse','m3','815.0','14']],[31*mm,56*mm,25*mm,36*mm,27*mm],['LEFT','LEFT','LEFT','RIGHT','RIGHT'])]
story += [p('Representative delivered-load appendix','Section'),table(['Date','Transaction','Item','Quantity','Driver','Truck'],[
    ['04 Apr 2026','20260404-DX1-00182','Crushed subbase 0-63 mm','17.500 m3','Omar Khalil','B 456321'],['04 Apr 2026','20260404-DX1-00183','Crushed subbase 0-63 mm','18.000 m3','Hassan Ali','M 221847'],['18 May 2026','20260518-DX1-00304','Basecourse 0-31.5 mm','17.250 m3','Omar Khalil','B 456321'],['10 Jun 2026','20260610-DX1-00381','Rock armour','18.600 t','Rami Nassar','G 774190'],['29 Jul 2026','20260729-DX1-00591','Rock armour','17.900 t','Hassan Ali','M 221847']],[27*mm,41*mm,48*mm,25*mm,29*mm,28*mm],font=6.6)]
story += [Spacer(1,3*mm),Table([[p('Appendix behavior','Sub'),p('The production export lists all 426 loads and automatically repeats table headings on every continuation page. Corrected confirmed loads appear with their current values while retaining their original transaction identity and confirmation time.')]],colWidths=[37*mm,138*mm],style=TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),.5,LINE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),3*mm),('RIGHTPADDING',(0,0),(-1,-1),3*mm),('TOPPADDING',(0,0),(-1,-1),2.5*mm),('BOTTOMPADDING',(0,0),(-1,-1),2.5*mm)])),PageBreak()]

# Page 4 - waste, resources and photos
story += [p('Waste, resources, and evidence','ReportTitle'),p('Waste Dump records are individual timestamped movements. Cancelled mistakes remain visible in history but are excluded from these active project totals.', 'Muted'),Spacer(1,3*mm)]
story += [p('Waste dump summary','Section'),Table([[table(['Material','Dumps'],[['Excavated soil','96'],['Rock spoil','34'],['Vegetation and trees','18'],['Mixed unsuitable material','16'],['Total','164']],[55*mm,27*mm],['LEFT','RIGHT']),table(['Dump location','Dumps'],[['Municipal approved dump','82'],['North quarry disposal area','46'],['Contractor stockpile B','24'],['Recycling yard','12'],['Total','164']],[63*mm,27*mm],['LEFT','RIGHT'])]],colWidths=[84*mm,92*mm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),2*mm)]))]
story += [p('People and equipment participation','Section'),table(['Category','Distinct recorded resources','Most frequently recorded'],[
    ['Workers','28','Foreman; surveyor; masons; drainage crew; general workers'],['Drivers','9','Omar Khalil; Hassan Ali; Rami Nassar'],['Trucks','12','B 456321; M 221847; G 774190'],['Machines','8','CAT 320 Excavator; Volvo L120 Loader; grader; roller; dozer; crane']],[31*mm,36*mm,108*mm])]
story += [p('Project photo evidence','Section'),p('Actual exports embed saved photos with their work date and position them in a two-column gallery. These placeholders demonstrate the layout.', 'Muted'),Spacer(1,2*mm),PhotoGrid(),Spacer(1,3*mm)]
story += [p('Completion and audit summary','Section'),table(['Record type','Active / included','Cancelled / excluded','Audit note'],[
    ['Daily reports','118','0','Editable project-day records retained after completion.'],['Delivered loads','426','0','Confirmed transaction identities retained.'],['Waste dumps','164','3','Three mistaken dumps cancelled with reason and time.'],['Project photos','286','-','Stored with source daily reports.'],['Issue days','9','-','All recorded issues closed before completion.'],['Project status','Completed','-','History and exports remain available; reactivation is required for new activity.']],[38*mm,31*mm,35*mm,71*mm],['LEFT','RIGHT','RIGHT','LEFT'])]

doc.build(story)
print(OUTPUT)
