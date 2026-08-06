# Requirements Elicitation Interview Transcript

## Turn 1
**INTERVIEWER:** Could you explain your app or business idea in your own words, including the problem you believe it solves?
**INTERVIEWEE:** okay the application will be about managing an asphalt plant

## Turn 2
**INTERVIEWER:** How is the asphalt plant managed today, and what is the biggest problem with that process?
**INTERVIEWEE:** it is my asphalt plant, it is run on papers and books, i want to digitalize it so i can see everything and have reports of everything

## Turn 3
**INTERVIEWER:** Walk me through a typical day at the plant, from the first activity to the last, including the paper records people create or use along the way.
**INTERVIEWEE:** so mostly the plant is used for private work , sometimes the batches are not recorded there is no histiry, only paper , no track of is truck driver on this pavment day no statistics, fuel are recorded on a paper and etc...

## Turn 4
**INTERVIEWER:** When you say “private work,” do you mean asphalt produced for your own company’s paving projects, and should the application also cover sales to outside customers?
**INTERVIEWEE:** yes mostly owr oun project some times people come they want asphalt we can record them and sometimes other companies come and want asphalt and also we can record how much they take and they can have histiry

## Turn 5
**INTERVIEWER:** When an outside customer asks for asphalt, what happens from their request until the asphalt leaves the plant, including how the quantity, price, and payment are currently recorded?
**INTERVIEWEE:** can u clarify

## Turn 6
**INTERVIEWER:** For the most recent outside customer, what did your staff do from the moment the customer arrived until their truck left with asphalt?
**INTERVIEWEE:** okay the truck come to the plant to get the empty weight of the truck then goes to the plant, then one on the asphalt plant doing the batch, another one on the wheel loader putting material for the plant, and one is looking around the plant when the truck is loaded with asphalt based on the customer desired weight it goes to the weight bridge to record the weight

## Turn 7
**INTERVIEWER:** After the loaded truck is weighed, what happens before it leaves—what record is created or given to the customer, and how is the amount they owe calculated and paid?
**INTERVIEWEE:** okay there are 2 recipts or invoice bills the first is delivery authorization the record will include name of company name of driver, plate number, empty weight, full weight, net weight , net weight in tons(we can set it later by using a conversion) destination address, signature and you can suggest me if  i need anything else, and the other is receipt where we can see the net weight and price

## Turn 8
**INTERVIEWER:** How should the receipt price be calculated from the net weight, and can the price per ton vary by asphalt type, customer, or agreement?
**INTERVIEWEE:** yes price per ton may vary so there will be an option to change the price per ton

## Turn 9
**INTERVIEWER:** Who should be allowed to change the price per ton, and should a change apply only to the current receipt or also update a default price for future sales?
**INTERVIEWEE:** me as a manager allowed to change the price and no the change will be default until i change it again

## Turn 10
**INTERVIEWER:** So far, the system will manage both your own paving projects and outside asphalt sales. For outside sales, it will track tare and loaded weights, customer and truck details, generate a delivery authorization and receipt, preserve customer history, and use a manager-controlled default price per ton.

The main uncertainties are the exact weight/price calculation, payment handling, and the workflow for your own paving projects.

Is this understanding accurate, or is there anything you want to correct?
**INTERVIEWEE:** For outside sales, it will track tare and loaded weights, customer and truck details, generate a delivery authorization and receipt, preserve customer history, and use a manager-controlled default price per ton. this is wrong for all sales my projects and outside proects all must be recorded

## Turn 11
**INTERVIEWER:** When a load goes to one of your own projects, what happens differently from an outside sale, especially regarding the delivery authorization, receipt, price, and payment?
**INTERVIEWEE:** dont think there is a difference instead of out side customer ill be the customer of my self

## Turn 12
**INTERVIEWER:** For a receipt issued to your own company, should the amount be recorded only as an internal project cost, or should the system record an actual payment as it would for an outside customer?
**INTERVIEWEE:** for my own projects i can keep the price empty

## Turn 13
**INTERVIEWER:** What unit does the weighbridge use, and should the system calculate net weight as full weight minus empty weight, then convert it to tons automatically?
**INTERVIEWEE:** it uses kg and i manually input the weight on the app and yes the system  shouuld calculate net weight as full weight minus empty weight then convert it to tons automatically if the conversion is set

## Turn 14
**INTERVIEWER:** Should the conversion always use the standard 1,000 kg = 1 ton, or should you be able to configure a different conversion value?
**INTERVIEWEE:** yes the asphalt conversion is 1000kg =1ton but if i have a concrete batch it will be different it will be in meter cube so its best to put an option conversion rate and choose which one

## Turn 15
**INTERVIEWER:** Should this first version manage concrete production and concrete batches too, or should it focus on asphalt while keeping configurable conversions for future materials?
**INTERVIEWEE:** both its simple dont over complicate it a concrete truck comes empty takes empty weight and then load it with concrete and take the weight and record and get the receipt or invoice same steps as aphlat

## Turn 16
**INTERVIEWER:** When staff create a load, should they choose “asphalt” or “concrete” and have the app automatically apply that material’s configured conversion rate and output unit?
**INTERVIEWEE:** its best to manually choose it what do you thibk

## Turn 17
**INTERVIEWER:** Should we confirm that staff manually choose the material, while the app automatically applies that material’s saved conversion rate and output unit?
**INTERVIEWEE:** clarify

## Turn 18
**INTERVIEWER:** If staff choose “asphalt,” the app uses kg-to-tons; if they choose “concrete,” it uses the saved kg-to-cubic-metres conversion—should it work that way?
**INTERVIEWEE:** yes

## Turn 19
**INTERVIEWER:** Should concrete use one default kg-to-cubic-metres conversion that you can change, or can different concrete mixes have different conversion rates?
**INTERVIEWEE:** if i want to change the conversion rate there will be an option add conversion rate anf then when iam doing a recept i choose the conversion rate that suits me

## Turn 20
**INTERVIEWER:** Who should be allowed to add or change the saved conversion-rate options—only you as manager, or other staff too?
**INTERVIEWEE:** me and authorized staff dont over complicate it

## Turn 21
**INTERVIEWER:** Quick checkpoint: the app manages all asphalt and concrete loads for your projects and outside customers using the same weighing and document workflow. Staff manually enter kilogram weights, choose the material and a saved conversion for the receipt, while you control pricing and you or authorized staff control conversions.

The main areas still unclear are batch details, fuel records, and the reports you need.

Is this accurate, or should I correct anything before we continue?
**INTERVIEWEE:** not asphalt and concrete only,you must add an option to add categories and add items where i name the category and item i need maybe i wanna keep track of the quarry trucks iam buying from a quarry and i can see how many and if they are paid or not and all details about them.

## Turn 22
**INTERVIEWER:** When a quarry truck delivers material you are buying, what happens from its arrival until you record whether that delivery has been paid?
**INTERVIEWEE:** you are not responsibleof any payeny uou just managen and track thats all, all payments are done in person

## Turn 23
**INTERVIEWER:** After an in-person payment, should the app track only “paid” or “unpaid,” or also the amount paid, payment date, and remaining balance?
**INTERVIEWEE:** also the amount paid, payment date, and remaining balance? so basically if every customer profile there should make a summary of the totall amount takes and total price and if we see the histiry we can see all the orders of that customer and we can see which is paid and which is not

## Turn 24
**INTERVIEWER:** Can a customer pay only part of an order, leaving a remaining balance, or must each order be marked fully paid at once?
**INTERVIEWEE:** yes he can

## Turn 25
**INTERVIEWER:** When a customer makes several partial payments for the same order, should the app keep each payment separately with its amount and date?
**INTERVIEWEE:** yes but they are linked to the same order lets say he has 2 orders , order  1and 2 he start paying for order 1 several partial payments so they are linked to order 1 and we can see how much and what is the date

## Turn 26
**INTERVIEWER:** When a quarry truck brings material you purchased, do you record its empty and full weights the same way as an outgoing load, or do you receive the quantity from the quarry’s document?
**INTERVIEWEE:** no i record only the quantity

## Turn 27
**INTERVIEWER:** For each quarry delivery, what unit is the quantity recorded in, and where do you get that quantity from?
**INTERVIEWEE:** the quantity is recorded in meter cube as i said before i can make these setting and add them

## Turn 28
**INTERVIEWER:** Should categories, items, and measurement units be managed by you and authorized staff, using the same simple permission rule as conversion rates?
**INTERVIEWEE:** yes

## Turn 29
**INTERVIEWER:** Besides the quarry, item, quantity, and payment information, what details should be recorded for each quarry-truck delivery?
**INTERVIEWEE:** driver plate number

## Turn 30
**INTERVIEWER:** When you record a quarry delivery, should its quantity automatically increase the available stock for that item?
**INTERVIEWEE:** no no need we only track quantities got from the quarry so we can track

## Turn 31
**INTERVIEWER:** Quick checkpoint: the app is configurable through categories, items, units, and conversions. It tracks outgoing customer/project orders with weights, documents, prices, and order-linked partial payments; it also tracks quarry deliveries and payments without managing stock or processing money.

The main areas still unclear are quarry summaries, production and fuel records, and the reports you need.

Is this accurate, or should I correct anything?
**INTERVIEWEE:** what do you mean by payment inf0
]

## Turn 32
**INTERVIEWER:** For each quarry delivery, should the app track the total price, each in-person amount paid and date, the remaining balance, and whether it is paid or unpaid?
**INTERVIEWEE:** also we can use the app to record fuel stock which machine is filled and the ammount also when iam a forman in the peoject i want to be able to make a report  of what happened during the work who came what material were used or transporeted with quantities and everything

## Turn 33
**INTERVIEWER:** Should the foreman create one report for each project workday, covering everything that happened during that day?
**INTERVIEWEE:** yes

## Turn 34
**INTERVIEWER:** In the daily report, should “who came” include only workers, or also drivers, trucks, machines, and visitors?
**INTERVIEWEE:** also drivers, trucks, machines conserning this i fill them manually

## Turn 35
**INTERVIEWER:** For each manually entered worker, driver, truck, or machine, what identifying details should the foreman record?
**INTERVIEWEE:** clarify

## Turn 36
**INTERVIEWER:** Should the foreman enter the worker or driver’s name, the truck’s plate number, and the machine’s name?
**INTERVIEWEE:** yes ofc

## Turn 37
**INTERVIEWER:** For each material in the daily report, should the foreman choose the item, enter its quantity and unit, and mark whether it was used or transported?
**INTERVIEWEE:** yes

## Turn 38
**INTERVIEWER:** After the foreman saves a daily report, should it remain editable, or should a manager approve and lock it?
**INTERVIEWEE:** remain editable the forman is me which is also the manager

## Turn 39
**INTERVIEWER:** When fuel is delivered to you, what information should you enter to increase the recorded fuel stock?
**INTERVIEWEE:** just how many liters got delivered

## Turn 40
**INTERVIEWER:** Should the app calculate current fuel stock as total litres delivered minus all litres filled into machines?
**INTERVIEWEE:** yes but there is a problem i cant track how much the plant consumes fuel so will only track machines

## Turn 41
**INTERVIEWER:** Should the app label the fuel balance as “estimated,” or should you be able to manually correct it after checking the actual fuel tank?
**INTERVIEWEE:** be able to manually correct it after checking the actual fuel tank?

## Turn 42
**INTERVIEWER:** Quick checkpoint: the app now covers configurable categories/items/units, outgoing orders and partial payments, quarry-delivery tracking without inventory, machine fuel usage with manual tank corrections, and editable daily project reports.

The main areas still unclear are the dashboards/reports you want, detailed user access, and error-handling rules.

Is this accurate, or should I correct anything?
**INTERVIEWEE:** looks good to me

## Turn 43
**INTERVIEWER:** When you open the app’s main dashboard, which numbers or alerts do you want to see first?
**INTERVIEWEE:** clarify

## Turn 44
**INTERVIEWER:** Which should appear on the home screen: today’s loads, unpaid orders, fuel balance, quarry totals, missing daily reports, or all of them?
**INTERVIEWEE:** what should be included is make a receipt this is very important and yeah add everything and i choose what i want to

## Turn 45
**INTERVIEWER:** Should each user choose their own dashboard summaries, or should you configure one dashboard that everyone sees?
**INTERVIEWEE:** no this is single user i want to make it for me

## Turn 46
**INTERVIEWER:** For the first version, will only you log in and use the app, with no staff accounts?
**INTERVIEWEE:** yes

## Turn 47
**INTERVIEWER:** Where do you need to use the first version: on a computer at the plant, on your phone while at projects, or on both?
**INTERVIEWEE:** first on the phone and also i want it to be able to print on a pos bluetooth

## Turn 48
**INTERVIEWER:** Will you use the first version on an Android phone, an iPhone, or both?
**INTERVIEWEE:** both

## Turn 49
**INTERVIEWER:** Do you already have a Bluetooth POS printer, and if so, what is its model and paper width?
**INTERVIEWEE:** yes i have the pos is digital pos printer it already has a screen but its very laggy and i cant take it everywhere with me its called x printer and uses 40mm so its small i want the system to support all kind of sizes

## Turn 50
**INTERVIEWER:** What exact model number is printed on the Xprinter’s label or settings screen?
**INTERVIEWEE:** i dont have it with me but i have a picture it says xprinter 58mm android pos and xp-pos-|100

## Turn 51
**INTERVIEWER:** Could you attach the picture so I can verify the exact model and printer details?
**INTERVIEWEE:** this was wriiten on the picture i think the 58 mm is the width of the papee

## Turn 52
**INTERVIEWER:** Should the phone app print to the existing Xprinter terminal, separate portable Bluetooth printers, or both?
**INTERVIEWEE:** both

## Turn 53
**INTERVIEWER:** If no printer is connected or printing fails, should the receipt still be saved so you can reprint it later?
**INTERVIEWEE:** yes ofcourse and i can print as much as i want until i exit

## Turn 54
**INTERVIEWER:** After you exit the receipt screen, should you be able to reopen that receipt from history and print it again?
**INTERVIEWEE:** yes

## Turn 55
**INTERVIEWER:** Quick checkpoint: version one is a single-user Android/iPhone app for you, with a prominent receipt workflow, saved receipt history, and unlimited reprinting to the existing Xprinter or compatible portable Bluetooth printers.

The main uncertainties are offline use, backup/recovery, and exact printer compatibility.

Is this accurate, or should I correct anything?
**INTERVIEWEE:** correct

## Turn 56
**INTERVIEWER:** Should you be able to create records, make and print receipts, and edit daily reports when there is no internet connection?
**INTERVIEWEE:** yes indeed

## Turn 57
**INTERVIEWER:** When internet returns, should offline changes sync automatically so the same data is available if you use another phone?
**INTERVIEWEE:** yes

## Turn 58
**INTERVIEWER:** If your phone is lost or replaced, should installing the app and signing in on a new phone automatically restore all synchronized data?
**INTERVIEWEE:** yes

## Turn 59
**INTERVIEWER:** How would you prefer to sign in: email and password, phone number with a code, or Google/Apple sign-in?
**INTERVIEWEE:** email and password

## Turn 60
**INTERVIEWER:** If you forget your password, should the app email you a secure password-reset link?
**INTERVIEWEE:** yes

## Turn 61
**INTERVIEWER:** After you sign in once, should the app stay accessible offline without asking for your password again each time you open it?
**INTERVIEWEE:** yes

## Turn 62
**INTERVIEWER:** Would you like an optional fingerprint, Face ID, or phone PIN lock for extra protection if someone else gets your phone?
**INTERVIEWEE:** nah no need

## Turn 63
**INTERVIEWER:** If your phone is lost and you reset your password, should that automatically sign the app out on the lost phone?
**INTERVIEWEE:** my phone will not get lost

## Turn 64
**INTERVIEWER:** Quick checkpoint: the app works offline, syncs automatically when internet returns, restores data on a new phone, and uses email/password with email recovery. Extra device-loss protections are intentionally excluded.

The main uncertainties are report/export formats, sync-failure handling, and final printer compatibility.

Is this accurate?
**INTERVIEWEE:** If your phone is lost and you reset your password, should that automatically sign the app out on the lost phone? make this a yes and ask me tge nect question again

## Turn 65
**INTERVIEWER:** When viewing a report, should you be able to export it as PDF, Excel, or both?
**INTERVIEWEE:** yes both

## Turn 66
**INTERVIEWER:** Before exporting a report, should you be able to filter it by date range, category or item, customer or project, and paid or unpaid status?
**INTERVIEWEE:** yes

## Turn 67
**INTERVIEWER:** If synchronization fails, should the app keep your data safely on the phone, show that it is still pending, and retry automatically later?
**INTERVIEWEE:** yes

i can add stafff   later but first i want it for single user

## Turn 68
**INTERVIEWER:** If the same record is edited offline on two phones, should the app keep the newest change automatically, or show both versions and let you choose?
**INTERVIEWEE:** okay

## Turn 69
**INTERVIEWER:** Should we use the simple rule that the newest edit automatically replaces the older version?
**INTERVIEWEE:** yes

## Turn 70
**INTERVIEWER:** After a receipt has been issued, should you be able to edit it directly, or should you cancel it and create a corrected receipt while keeping the original in history?
**INTERVIEWEE:** both

directly correct it

## Turn 71
**INTERVIEWER:** When you correct a receipt, should the app keep the old values in a change history, or keep only the corrected values?
**INTERVIEWEE:** keep the corrected

## Turn 72
**INTERVIEWER:** If you correct a receipt’s weights or price, should the app automatically recalculate the net quantity, total price, remaining balance, and customer summary?
**INTERVIEWEE:** yes

## Turn 73
**INTERVIEWER:** Quick checkpoint: reports export to filtered PDF/Excel, failed sync safely retries, conflicts use the newest edit, and receipts can be directly corrected with automatic recalculation while keeping only corrected values.

The main uncertainties are deletion/backup recovery, validation of incorrect entries, and final printer testing.

Is this accurate?
**INTERVIEWEE:** if conflict use the newest edit and there is somwthing wrong youo can edit to correct

## Turn 74
**INTERVIEWER:** If you delete a record by mistake, should it go to a trash area where you can restore it, or be deleted permanently immediately?
**INTERVIEWEE:** clarify

## Turn 75
**INTERVIEWER:** If you accidentally delete a receipt or order, should you be able to recover it from a trash folder instead of losing it forever?
**INTERVIEWEE:** yes okay

## Turn 76
**INTERVIEWER:** Should deleted records stay in trash until you manually remove them, or be permanently deleted automatically after 30 days?
**INTERVIEWEE:** before this question i want to shed light to something when a receipt is done and confiremed it cant be deleted

## Turn 77
**INTERVIEWER:** What makes a receipt “confirmed”: pressing a separate Confirm button after reviewing it, or simply saving it?
**INTERVIEWEE:** yes i fill the receipt and when i am done i review it and confirm it so i can start printing

## Turn 78
**INTERVIEWER:** Before confirmation, should you be able to freely edit or delete the draft receipt?
**INTERVIEWEE:** yes when i confirmit after review i can print it aand it is saved and i can also make it a pdf

## Turn 79
**INTERVIEWER:** For records that are allowed in trash, should they stay there until you manually delete them, or be removed automatically after 30 days?
**INTERVIEWEE:** manually delete them

## Turn 80
**INTERVIEWER:** Should every record that is allowed to be deleted go to trash first, with confirmed receipts as the only non-deletable exception?
**INTERVIEWEE:** clarify

## Turn 81
**INTERVIEWER:** Should deleted drafts, customer orders, quarry entries, fuel entries, and daily reports all go to trash, while confirmed receipts cannot be deleted?
**INTERVIEWEE:** EVERYTHING MUST be confirmed first

## Turn 82
**INTERVIEWER:** Should every record follow Draft → Review → Confirm, after which it cannot be deleted but can still be directly corrected?
**INTERVIEWEE:** what do you think of this

## Turn 83
**INTERVIEWER:** Should we use confirmation for all business records, while categories, items, units, and conversions save directly without confirmation?
**INTERVIEWEE:** looks good to me

## Turn 84
**INTERVIEWER:** Should the Confirm button remain disabled until every required field is completed and valid, with clear messages showing what must be fixed?
**INTERVIEWEE:** clarify

## Turn 85
**INTERVIEWER:** If a receipt is missing the customer, truck plate, or required weights, should the app prevent confirmation and highlight what is missing?
**INTERVIEWEE:** yes

## Turn 86
**INTERVIEWER:** Should the app reject negative weights and prevent confirmation when the full truck weight is less than or equal to the empty weight?
**INTERVIEWEE:** yes indeed 

## Turn 87
**INTERVIEWER:** Quick checkpoint: all business records use Draft → Review → Confirm. Confirmed records cannot be deleted but can be corrected. Eligible drafts stay in trash until manually removed. Receipts cannot be confirmed with missing or invalid weights. The remaining uncertainties include payment validation, draft autosave, and final printer testing. Is this accurate?
**INTERVIEWEE:** looks good to me

## Turn 88
**INTERVIEWER:** When recording a partial payment, should the amount be greater than zero and never exceed that order’s remaining balance?
**INTERVIEWEE:** clarify

## Turn 89
**INTERVIEWER:** Example: an order has a remaining balance of $1,000, but you enter a payment of $1,200. Should the app block the $1,200 payment because it exceeds the remaining balance?
**INTERVIEWEE:** what do you think

## Turn 90
**INTERVIEWER:** I recommend blocking it. Each payment must be greater than zero and cannot exceed the order’s remaining balance. This keeps balances accurate and avoids adding a more complicated customer-credit system. Should we use this rule?
**INTERVIEWEE:** yes

## Turn 91
**INTERVIEWER:** If a confirmed order was $1,000 and fully paid, but you later correct its total to $800, should the app keep the recorded payments unchanged and show “Overpaid: $200”?
**INTERVIEWEE:** clarify

## Turn 92
**INTERVIEWER:** This can happen after a correction: original order total $1,000; customer already paid $1,000; corrected order total $800; the customer has paid $200 more than the corrected total. The app will not refund money—it only records the situation. Should it keep the original payment records and display “Overpaid: $200”?
**INTERVIEWEE:** okay yes

## Turn 93
**INTERVIEWER:** Should the app automatically save a business-record draft while you are entering it, so closing the app or losing power does not lose your work?
**INTERVIEWEE:** yes

## Turn 94
**INTERVIEWER:** If you intentionally delete an autosaved draft, should it move to the trash so you can restore it later?
**INTERVIEWEE:** yes

## Turn 95
**INTERVIEWER:** Before permanently deleting anything from the trash, should the app display a warning and require you to confirm the deletion?
**INTERVIEWEE:** yes

## Turn 96
**INTERVIEWER:** Should synchronized confirmed records be kept indefinitely, with no automatic expiration or deletion from the backup?
**INTERVIEWEE:** clarify

## Turn 97
**INTERVIEWER:** Example: you create confirmed receipts and reports today. Five or ten years later—or after replacing your phone—those records should still be available from the synchronized backup. Should the app keep all confirmed records permanently instead of automatically removing old records after a certain number of years?
**INTERVIEWEE:** all records must remain

## Turn 98
**INTERVIEWER:** When you stop using a category, item, unit, or conversion rate, should the app deactivate it—hiding it from new records—while keeping it visible on old records?
**INTERVIEWEE:** clarify

## Turn 99
**INTERVIEWER:** Example: you create a conversion named “Asphalt kg to ton” and use it on 500 receipts. Later, you replace it with a new conversion. Deleting the old conversion could damage those 500 receipts. Deactivating it means it remains shown correctly on old receipts, no longer appears for new receipts, and can be reactivated later. Should the app use this deactivation method?
**INTERVIEWEE:** yes but that will not affect the old receipts so how did you say Deleting the old conversion could damage those 500 receipts

## Turn 100
**INTERVIEWER:** You are correct. Deleting a conversion would only damage old receipts in a poorly designed system where receipts depend on the current conversion record. We will store a snapshot on every confirmed receipt: the conversion name, input unit, output unit, rate, and calculated quantity used at confirmation. Therefore, editing, deactivating, or even removing the original setting cannot change old receipts. Should each confirmed receipt preserve that exact conversion snapshot permanently?
**INTERVIEWEE:** what is snapshot

## Turn 101
**INTERVIEWER:** A snapshot simply means a saved copy of the values used at that moment. Example: a receipt uses conversion “Asphalt kg to ton,” rate 1,000 kg = 1 ton, weight 20,000 kg, and result 20 tons. The receipt saves its own copy, so later conversion changes cannot alter it. Should every confirmed receipt save its own permanent copy of the conversion values it used?
**INTERVIEWEE:** yes

## Turn 102
**INTERVIEWER:** Quick checkpoint: payments must be positive and cannot exceed the remaining balance. Corrections can create a clearly displayed overpayment without changing payment history. Drafts autosave and deleted drafts go to trash. Permanent deletion requires a warning. Confirmed records remain permanently. Unused settings are deactivated, and every receipt keeps its own copy of the conversion values used. The main uncertainties now are printer compatibility testing and which other record types can enter trash. Is this accurate?
**INTERVIEWEE:** in the conversion i choose which conversion rate from the drop down to be applied and also i want to make receipts can be sent as a pdf or invoice bill

## Turn 103
**INTERVIEWER:** By “invoice bill,” do you mean a separate invoice document—with quantity, price, total, paid amount, and remaining balance—in addition to the delivery authorization and receipt?
**INTERVIEWEE:** what do you think, i want botth delivery auth and receipt to be pdf  and i think whqt i mean by invoice bill is receipt

## Turn 104
**INTERVIEWER:** I agree. A third document would duplicate the same information and make the workflow confusing. We should have only a delivery authorization and a receipt, also called the invoice bill. Both can be printed, saved as PDF, and sent from the phone. Should we confirm this as the final document setup?
**INTERVIEWEE:** looks good to me
