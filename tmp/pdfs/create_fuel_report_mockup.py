from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Flowable,
)

OUTPUT = r"C:\Users\fakih\Desktop\Dromex\DROMEX\output\pdf\DROMEX-Fuel-Tracking-Report-Sample.pdf"
W, H = A4
BRAND = colors.HexColor("#C84B31")
BRAND_DARK = colors.HexColor("#8E2E1B")
INK = colors.HexColor("#17212B")
MUTED = colors.HexColor("#65717D")
PALE = colors.HexColor("#F5F2EC")
LINE = colors.HexColor("#D9D5CE")
GREEN = colors.HexColor("#26735B")
AMBER = colors.HexColor("#A66A13")
RED_PALE = colors.HexColor("#FCE8E6")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="ReportTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=25, textColor=BRAND_DARK, alignment=TA_RIGHT, spaceAfter=2*mm))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=BRAND_DARK, spaceBefore=3*mm, spaceAfter=2*mm, borderWidth=0, borderPadding=0))
styles.add(ParagraphStyle(name="Subsection", parent=styles["Heading3"], fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=INK, spaceBefore=2*mm, spaceAfter=1.5*mm))
styles.add(ParagraphStyle(name="BodySmall", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=12, textColor=INK))
styles.add(ParagraphStyle(name="Muted", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.8, leading=11, textColor=MUTED))
styles.add(ParagraphStyle(name="MetricValue", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=17, leading=19, textColor=BRAND_DARK))
styles.add(ParagraphStyle(name="MetricLabel", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.5, leading=9, textColor=MUTED))
styles.add(ParagraphStyle(name="RightSmall", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.5, leading=10, textColor=MUTED, alignment=TA_RIGHT))


def p(text, style="BodySmall"):
    return Paragraph(str(text), styles[style])


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(14*mm, H-12*mm, "DROMEX")
    canvas.setFillColor(BRAND)
    canvas.rect(14*mm, H-15*mm, 30*mm, 1.4*mm, fill=1, stroke=0)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawRightString(W-14*mm, H-11.5*mm, "Fuel Tracking Report  |  SAMPLE LAYOUT")
    canvas.setStrokeColor(LINE)
    canvas.line(14*mm, 12*mm, W-14*mm, 12*mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(14*mm, 7.5*mm, "Generated offline from on-device records  |  Amounts in USD  |  Litres shown to 1 decimal")
    canvas.drawRightString(W-14*mm, 7.5*mm, f"Page {doc.page}")
    canvas.restoreState()


def metric(value, label, note=""):
    return Table([[p(value, "MetricValue")], [p(label, "MetricLabel")], [p(note, "Muted")]], colWidths=[52*mm], rowHeights=[8*mm, 5*mm, 8*mm], style=TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), PALE), ("BOX", (0,0), (-1,-1), .5, LINE),
        ("LEFTPADDING", (0,0), (-1,-1), 4*mm), ("RIGHTPADDING", (0,0), (-1,-1), 3*mm),
        ("TOPPADDING", (0,0), (-1,-1), 1.5*mm), ("BOTTOMPADDING", (0,0), (-1,-1), 1*mm),
    ]))


def data_table(headers, rows, widths, aligns=None, font=7.4):
    values = [[p(h, "Muted") for h in headers]] + [[p(v, "BodySmall") for v in row] for row in rows]
    commands = [
        ("BACKGROUND", (0,0), (-1,0), PALE), ("TEXTCOLOR", (0,0), (-1,0), MUTED),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"), ("FONTSIZE", (0,0), (-1,-1), font),
        ("GRID", (0,0), (-1,-1), .35, LINE), ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 2*mm), ("RIGHTPADDING", (0,0), (-1,-1), 2*mm),
        ("TOPPADDING", (0,0), (-1,-1), 1.5*mm), ("BOTTOMPADDING", (0,0), (-1,-1), 1.5*mm),
    ]
    for i, align in enumerate(aligns or []):
        commands.append(("ALIGN", (i,1), (i,-1), align))
    return Table(values, colWidths=widths, repeatRows=1, style=TableStyle(commands))


class BarChart(Flowable):
    def __init__(self, data, width=170*mm, height=52*mm):
        super().__init__(); self.data=data; self.width=width; self.height=height
    def draw(self):
        c=self.canv; maxv=max(v for _,v in self.data); left=38*mm; right=15*mm; usable=self.width-left-right
        row_h=self.height/len(self.data)
        for i,(label,value) in enumerate(self.data):
            y=self.height-(i+1)*row_h+3*mm
            c.setFillColor(MUTED); c.setFont("Helvetica",7.5); c.drawRightString(left-2*mm,y+2.2*mm,label)
            c.setFillColor(PALE); c.roundRect(left,y,usable,5*mm,1.5*mm,fill=1,stroke=0)
            c.setFillColor(BRAND); c.roundRect(left,y,usable*value/maxv,5*mm,1.5*mm,fill=1,stroke=0)
            c.setFillColor(INK); c.setFont("Helvetica-Bold",7.5); c.drawString(left+usable+2*mm,y+1.2*mm,f"{value:,.0f} L")


doc = BaseDocTemplate(OUTPUT, pagesize=A4, rightMargin=14*mm, leftMargin=14*mm, topMargin=22*mm, bottomMargin=16*mm, title="DROMEX Fuel Tracking Report Sample")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates(PageTemplate(id="report", frames=frame, onPage=header_footer))
story=[]

# Page 1 - Executive summary
story += [Spacer(1, 4*mm), Table([[p("DROMEX SAL", "Subsection"), p("Fuel Tracking Report", "ReportTitle")], [p("Main Plant - Lebanon", "Muted"), p("01 July 2026 to 31 July 2026", "RightSmall")]], colWidths=[75*mm, 103*mm], style=TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"), ("LEFTPADDING",(0,0),(-1,-1),0), ("RIGHTPADDING",(0,0),(-1,-1),0)])), Spacer(1,4*mm)]
story.append(Table([[metric("12,450.0 L", "Opening calculated balance", "Based on latest valid gauge baseline"), metric("18,900.0 L", "Fuel delivered", "6 active supplier deliveries"), metric("16,275.0 L", "Equipment fills", "47 active fill records")]], colWidths=[58.5*mm]*3, style=TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"), ("LEFTPADDING",(0,0),(-1,-1),1*mm), ("RIGHTPADDING",(0,0),(-1,-1),1*mm)])))
story += [Spacer(1,3*mm), Table([[metric("15,075.0 L", "Current calculated balance", "After latest physical correction"), metric("2,625.0 L", "Net movement", "+ deliveries - equipment fills"), metric("$20,790.00", "Delivered fuel value", "$2,286.90 VAT included")]], colWidths=[58.5*mm]*3, style=TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"), ("LEFTPADDING",(0,0),(-1,-1),1*mm), ("RIGHTPADDING",(0,0),(-1,-1),1*mm)])), Spacer(1,4*mm)]
story += [p("Balance calculation", "Section"), Table([[p("Latest physical gauge baseline", "Muted"), p("13,800.0 L", "BodySmall")], [p("+ deliveries after baseline", "Muted"), p("7,200.0 L", "BodySmall")], [p("- equipment fills after baseline", "Muted"), p("5,925.0 L", "BodySmall")], [p("Current calculated balance", "Subsection"), p("15,075.0 L", "Subsection")]], colWidths=[115*mm,60*mm], style=TableStyle([("BACKGROUND",(0,3),(-1,3),PALE),("BOX",(0,0),(-1,-1),.5,LINE),("INNERGRID",(0,0),(-1,-1),.35,LINE),("ALIGN",(1,0),(1,-1),"RIGHT"),("LEFTPADDING",(0,0),(-1,-1),3*mm),("RIGHTPADDING",(0,0),(-1,-1),3*mm),("TOPPADDING",(0,0),(-1,-1),2*mm),("BOTTOMPADDING",(0,0),(-1,-1),2*mm)]))]
story += [p("Period summary", "Section"), data_table(["Movement type","Active records","Litres","Value before VAT","VAT","Final value"], [["Supplier deliveries","6","18,900.0","$18,503.10","$2,286.90","$20,790.00"],["Equipment fills","47","16,275.0","-","-","-"],["Physical corrections","1","-1,250.0 difference","-","-","-"],["Cancelled movements","2","Excluded","Excluded","Excluded","Excluded"]],[43*mm,25*mm,29*mm,28*mm,24*mm,29*mm], ["LEFT","RIGHT","RIGHT","RIGHT","RIGHT","RIGHT"])]
story += [Spacer(1,3*mm), Table([[p("Important", "Subsection"), p("The calculated balance does not estimate plant consumption. Physical tank readings reconcile any difference and establish the next baseline without rewriting previous movements.", "BodySmall")]], colWidths=[28*mm,147*mm], style=TableStyle([("BACKGROUND",(0,0),(-1,-1),RED_PALE),("BOX",(0,0),(-1,-1),.5,BRAND),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),3*mm),("RIGHTPADDING",(0,0),(-1,-1),3*mm),("TOPPADDING",(0,0),(-1,-1),2.5*mm),("BOTTOMPADDING",(0,0),(-1,-1),2.5*mm)])), PageBreak()]

# Page 2 - Movement ledger
story += [p("Fuel movement details", "ReportTitle"), p("All active and cancelled deliveries, equipment fills, and physical corrections in chronological order. Cancelled records remain visible but do not affect totals.", "Muted"), Spacer(1,3*mm)]
movement_rows=[
    ["01 Jul 07:35","Delivery","Cedars Fuel Co.","INV-8814","5,000.0","+5,000.0","17,450.0","$5,500.00","Unpaid"],
    ["01 Jul 10:12","Equipment fill","CAT 320 Excavator","HM-2381","350.0","-350.0","17,100.0","-","Active"],
    ["02 Jul 08:08","Equipment fill","Volvo Loader L120","HM-2390","420.0","-420.0","16,680.0","-","Active"],
    ["04 Jul 09:15","Delivery","Bekaa Petroleum","TKT-44721","3,200.0","+3,200.0","19,880.0","$3,520.00","Paid"],
    ["08 Jul 16:40","Equipment fill","Generator G-02","GEN-721","180.0","-180.0","19,700.0","-","Active"],
    ["12 Jul 07:50","Delivery","Cedars Fuel Co.","INV-8892","4,500.0","+4,500.0","24,200.0","$4,950.00","Partially paid"],
    ["15 Jul 17:20","Physical correction","Tank gauge reading","GAUGE-0715","13,800.0","-1,250.0","13,800.0","-","Active baseline"],
    ["16 Jul 08:05","Equipment fill","CAT 320 Excavator","HM-2418","375.0","-375.0","13,425.0","-","Active"],
    ["18 Jul 11:24","Delivery","Bekaa Petroleum","TKT-45108","4,000.0","+4,000.0","17,425.0","$4,400.00","Unpaid"],
    ["21 Jul 09:41","Equipment fill","Volvo Loader L120","HM-2440","450.0","-450.0","16,975.0","-","Active"],
    ["24 Jul 14:10","Equipment fill","Water Truck WT-01","WT-104","300.0","-300.0","16,675.0","-","Active"],
    ["27 Jul 07:42","Delivery","Cedars Fuel Co.","INV-8977","2,200.0","+2,200.0","18,875.0","$2,420.00","Unpaid"],
    ["29 Jul 13:05","Equipment fill","Generator G-02","GEN-748","200.0","-200.0","18,675.0","-","Cancelled"],
    ["31 Jul 16:55","Equipment fill","CAT 320 Excavator","HM-2472","400.0","-400.0","15,075.0","-","Active"],
]
story.append(data_table(["Date / time","Movement","Supplier / equipment","Reference","Litres","Effect","Balance after","Final value","Status"], movement_rows,[24*mm,21*mm,32*mm,20*mm,16*mm,17*mm,20*mm,20*mm,22*mm],["LEFT","LEFT","LEFT","LEFT","RIGHT","RIGHT","RIGHT","RIGHT","LEFT"],6.4))
story += [Spacer(1,3*mm), p("Selected movement detail", "Section"), data_table(["Field","Recorded value"], [["Movement","Physical tank correction - Active baseline"],["Date and time","15 July 2026, 17:20"],["Previous calculated balance","15,050.0 L"],["Actual gauge reading","13,800.0 L"],["Signed difference","-1,250.0 L"],["Reason","End-of-day physical gauge reconciliation"],["Notes","Plant consumption and evaporation difference reconciled; dip reading witnessed by foreman."]],[52*mm,123*mm])]
story.append(PageBreak())

# Page 3 - Equipment and controls
story += [p("Equipment fuel totals", "ReportTitle"), p("Totals include active equipment-fill records in the selected period. Each equipment profile can be opened in the app for its complete fill history.", "Muted"), Spacer(1,3*mm), BarChart([("CAT 320 Excavator",5150),("Volvo Loader L120",4320),("Water Truck WT-01",2880),("Generator G-02",2105),("Paver AP-01",1820)])]
story += [p("Equipment breakdown", "Section"), data_table(["Equipment","Type / identifier","Fills","Total litres","Average fill","Projects served"], [["CAT 320 Excavator","Excavator / CAT320-07","14","5,150.0","367.9","Ain Qana Roadworks"],["Volvo Loader L120","Wheel loader / VL120-03","11","4,320.0","392.7","Main Plant; Ain Qana"],["Water Truck WT-01","Water truck / 554321 M","8","2,880.0","360.0","Ain Qana Roadworks"],["Generator G-02","Generator / GEN-02","9","2,105.0","233.9","Main Plant"],["Paver AP-01","Asphalt paver / AP-01","5","1,820.0","364.0","Ain Qana Roadworks"]],[39*mm,38*mm,18*mm,25*mm,25*mm,32*mm],["LEFT","LEFT","RIGHT","RIGHT","RIGHT","LEFT"])]
story += [p("Physical gauge readings and corrections", "Section"), data_table(["Date / time","Actual reading","Previous balance","Difference","Reason","Status"], [["15 Jul 2026 17:20","13,800.0 L","15,050.0 L","-1,250.0 L","Physical gauge reconciliation","Active baseline"],["30 Jun 2026 18:00","12,450.0 L","12,610.0 L","-160.0 L","Month-end dip reading","Superseded baseline"],["18 Jun 2026 17:45","11,900.0 L","12,120.0 L","-220.0 L","Gauge verification","Cancelled"]],[29*mm,27*mm,29*mm,25*mm,43*mm,25*mm],["LEFT","RIGHT","RIGHT","RIGHT","LEFT","LEFT"])]
story += [p("Cancelled records retained for audit", "Section"), data_table(["Record","Original effect","Cancellation evidence","Financial / stock treatment"], [["Equipment fill GEN-748","-200.0 L","29 Jul 2026 13:20 - Duplicate entry","Excluded; later active movements recalculated"],["Gauge correction 18 Jun","Baseline 11,900.0 L","18 Jun 2026 18:02 - Wrong gauge reading","Retained but ignored; preceding valid baseline continued"]],[39*mm,32*mm,60*mm,46*mm])]
story += [Spacer(1,2*mm), p("Filters available in the app: date range, movement type, supplier, equipment, project, payment status, and Active/Cancelled status. PDF and Excel exports generate locally and remain available offline.", "Muted")]

doc.build(story)
print(OUTPUT)
