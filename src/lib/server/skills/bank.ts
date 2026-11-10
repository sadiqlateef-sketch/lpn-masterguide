import type { ClientNeedId } from "@/lib/blueprint-ids";
import type { ChoicePayload } from "../practice";

// Skills checklists (F17): the core LPN skills a clinical instructor checks off, step by step.
// Steps marked critical are the ones that fail a check-off when missed (safety, asepsis, the rights).
// Each skill ends with two NCLEX-style questions, saved as practice items the first time it's opened.

export type SkillStep = { text: string; why: string; critical?: boolean };

export type SkillQuestion = ChoicePayload & { key: string; client_need_id: ClientNeedId };

export type Skill = {
  id: string;
  title: string;
  blurb: string;
  steps: SkillStep[];
  questions: SkillQuestion[];
};

const ABCD = (a: string, b: string, c: string, d: string) => [
  { id: "A", text: a },
  { id: "B", text: b },
  { id: "C", text: c },
  { id: "D", text: d },
];

const whys = (a: string, b: string, c: string, d: string) => [
  { id: "A", why: a },
  { id: "B", why: b },
  { id: "C", why: c },
  { id: "D", why: d },
];

export const SKILLS: readonly Skill[] = [
  {
    id: "hand_hygiene",
    title: "Hand hygiene",
    blurb: "Soap and water, the way a check-off expects it.",
    steps: [
      { text: "Choose soap and water when hands are visibly soiled, after C. diff or norovirus care, and before eating.", why: "Alcohol rub doesn't kill C. diff spores or remove dirt.", critical: true },
      { text: "Take off rings and watch, and push sleeves above the wrists.", why: "Jewelry and cuffs hold microbes that washing can't reach." },
      { text: "Stand back from the sink so your uniform doesn't touch it.", why: "The sink is treated as dirty." },
      { text: "Wet hands with warm water, keeping hands lower than elbows.", why: "Water runs from the cleaner forearm down to the fingertips, not back up the arm." },
      { text: "Rub every surface with soap for at least 20 seconds: palms, backs, between fingers, thumbs and under nails.", why: "Friction and time remove the microbes, more than the soap itself.", critical: true },
      { text: "Rinse from wrists to fingertips, hands still lower than elbows.", why: "Rinse water carries soil off the fingertips, away from clean skin." },
      { text: "Dry from fingertips toward wrists with a clean paper towel.", why: "Drying goes from the cleanest area to the least clean." },
      { text: "Turn off the faucet with a dry paper towel, not your clean hand.", why: "The handle was touched with dirty hands.", critical: true },
    ],
    questions: [
      {
        key: "cdiff",
        client_need_id: "safety_infection",
        stem: "The LPN has finished morning care for a client with Clostridioides difficile infection. Which hand hygiene is right before leaving the room?",
        options: ABCD("An alcohol-based hand rub", "Washing with soap and water", "Taking off gloves, with no other hand hygiene", "An antiseptic hand wipe"),
        correct_option_ids: ["B"],
        rationale: "C. diff spores resist alcohol, so friction with soap and water is needed to remove them. Gloves don't replace hand hygiene.",
        option_rationales: whys(
          "Alcohol doesn't kill C. diff spores.",
          "Soap, water and friction physically remove the spores.",
          "Hands are contaminated when gloves come off; hand hygiene is still needed.",
          "Wipes don't remove spores the way washing does.",
        ),
      },
      {
        key: "asepsis",
        client_need_id: "safety_infection",
        stem: "A student is observed washing their hands. Which action needs correcting?",
        options: ABCD("Keeping hands lower than the elbows", "Rubbing hands with soap for 20 seconds", "Leaning against the sink while washing", "Drying from the fingertips toward the wrists"),
        correct_option_ids: ["C"],
        rationale: "The sink is contaminated, so touching it with the uniform carries microbes away on the student's clothes. The other actions are correct.",
        option_rationales: whys(
          "Correct: water runs off the fingertips, away from the arms.",
          "Correct: 20 seconds of friction is the standard.",
          "This contaminates the uniform; stand back from the sink.",
          "Correct: dry from cleanest to least clean.",
        ),
      },
    ],
  },
  {
    id: "vital_signs",
    title: "Vital signs",
    blurb: "Temperature, pulse, breathing, blood pressure and oxygen.",
    steps: [
      { text: "Do hand hygiene and identify the client with two identifiers.", why: "Right client, and no microbes carried in.", critical: true },
      { text: "For an oral temperature, check the client hasn't eaten, had a hot or cold drink or smoked in the last 15 to 30 minutes.", why: "Each one changes mouth temperature." },
      { text: "Take the temperature with the right device and route for this client.", why: "Routes read differently, so record which one you used." },
      { text: "Count the radial pulse for 30 seconds and double it if regular; count a full 60 seconds if irregular.", why: "A short count misses or multiplies irregular beats.", critical: true },
      { text: "Count breaths for 30 seconds (60 if irregular) while still holding the wrist, without telling the client.", why: "People breathe differently when they know they're watched." },
      { text: "Pick a cuff whose bladder wraps about 80% of the upper arm.", why: "A small cuff reads falsely high; a large one, falsely low.", critical: true },
      { text: "Seat the client with back supported, feet flat, arm supported at heart level, and not talking.", why: "Each of these changes the reading." },
      { text: "Check oxygen saturation and ask about pain.", why: "Both are routinely charted with vital signs." },
      { text: "Record the values and report anything out of range to the RN.", why: "Abnormal findings need the RN's assessment and the plan changed.", critical: true },
    ],
    questions: [
      {
        key: "cuff",
        client_need_id: "risk_reduction",
        stem: "The LPN uses a blood pressure cuff that is too small for the client's arm. What effect should the LPN expect on the reading?",
        options: ABCD("It will read falsely high.", "It will read falsely low.", "It will be accurate if the arm is at heart level.", "It won't give a reading at all."),
        correct_option_ids: ["A"],
        rationale: "A narrow cuff needs more pressure to close off the artery, so the reading comes out falsely high. The bladder should wrap about 80% of the arm.",
        option_rationales: whys(
          "Correct: a small cuff overestimates pressure.",
          "A cuff that is too large gives a falsely low reading.",
          "Arm position matters, but it doesn't fix a wrong cuff size.",
          "A small cuff still gives a reading; it's just wrong.",
        ),
      },
      {
        key: "irregular",
        client_need_id: "risk_reduction",
        stem: "While taking a radial pulse, the LPN notices the rhythm is irregular. What should the LPN do?",
        options: ABCD("Count for 15 seconds and multiply by 4.", "Count for 30 seconds and multiply by 2.", "Count for a full 60 seconds.", "Skip the pulse and take the blood pressure instead."),
        correct_option_ids: ["C"],
        rationale: "An irregular pulse must be counted for a full minute (often apically) so skipped or extra beats aren't missed or multiplied. Report a new irregular rhythm to the RN.",
        option_rationales: whys(
          "Too short: multiplying exaggerates any error.",
          "Fine only for a regular rhythm.",
          "Correct: a full minute for any irregular pulse.",
          "Blood pressure doesn't replace the pulse count.",
        ),
      },
    ],
  },
  {
    id: "med_pass",
    title: "Oral med pass",
    blurb: "The rights, the checks and the questions instructors ask.",
    steps: [
      { text: "Check each medicine on the MAR against the order, and check the client's allergies.", why: "Most errors start with a transcription or allergy miss.", critical: true },
      { text: "Check the rights three times: taking it out, preparing it, and at the bedside.", why: "Three checks catch what one misses.", critical: true },
      { text: "Do the checks a medicine needs first, like the apical pulse before digoxin or the blood pressure before an antihypertensive.", why: "These decide whether the dose is given or held.", critical: true },
      { text: "Identify the client with two identifiers and scan the wristband.", why: "Room number and the client's say-so alone aren't enough.", critical: true },
      { text: "Tell the client the name and purpose of each medicine.", why: "Clients catch errors when they know what to expect." },
      { text: "Sit the client upright and check they can swallow.", why: "Prevents aspiration." },
      { text: "Stay until every pill is swallowed; never leave medicines at the bedside.", why: "You can only chart what you saw taken.", critical: true },
      { text: "Chart each medicine right after it's given, never before.", why: "Charting first records a dose that may never be taken.", critical: true },
      { text: "Report a held or refused dose to the RN.", why: "The prescriber may need to change the plan." },
    ],
    questions: [
      {
        key: "digoxin",
        client_need_id: "pharm",
        stem: "Before giving digoxin 0.125 mg by mouth, the LPN counts an apical pulse of 54 beats per minute. What should the LPN do?",
        options: ABCD("Give the dose and recheck the pulse in an hour.", "Hold the dose and report the pulse to the RN.", "Give half the dose.", "Give the dose with food to slow absorption."),
        correct_option_ids: ["B"],
        rationale: "Digoxin slows the heart, so an adult apical pulse under 60 is the usual hold parameter. The LPN holds it and reports; changing the dose isn't within the LPN's role.",
        option_rationales: whys(
          "Giving it could slow the heart further.",
          "Correct: hold below 60 and report.",
          "The LPN can't change a prescribed dose.",
          "Food doesn't make a low pulse safe.",
        ),
      },
      {
        key: "wristband",
        client_need_id: "safety_infection",
        stem: "At the bedside, the LPN finds the client isn't wearing an ID band. The client says their name. What should the LPN do?",
        options: ABCD("Give the medicines, since the client stated their name.", "Ask the roommate to confirm who the client is.", "Hold the medicines until the client's identity is confirmed with two identifiers and a band is replaced.", "Check the name on the door and give the medicines."),
        correct_option_ids: ["C"],
        rationale: "Two identifiers checked against the MAR are required before every medicine. A name alone, a roommate or a door sign aren't reliable.",
        option_rationales: whys(
          "One identifier isn't enough, and a confused client may answer to any name.",
          "A roommate isn't a valid identifier.",
          "Correct: confirm identity properly before giving anything.",
          "Room assignments change; a door sign isn't an identifier.",
        ),
      },
    ],
  },
  {
    id: "sterile_gloves",
    title: "Sterile gloves",
    blurb: "Open gloving without touching a thing you shouldn't.",
    steps: [
      { text: "Do hand hygiene, and check the package is dry, intact and in date.", why: "A wet, torn or expired package isn't sterile.", critical: true },
      { text: "Open the outer package on a clean, dry surface at waist height or above.", why: "Anything below the waist is out of sight and treated as unsterile." },
      { text: "Open the inner wrapper by touching only its outer edges.", why: "The inside of the wrapper is sterile." },
      { text: "With your nondominant hand, pick up the first glove by the inside of its folded cuff.", why: "Bare skin may only touch the glove's inside.", critical: true },
      { text: "Slide your dominant hand in and pull the glove on, touching only the cuff's inside.", why: "Keeps the outside of the glove sterile." },
      { text: "Slip your gloved fingers under the cuff of the second glove, touching only its outside.", why: "Sterile touches sterile.", critical: true },
      { text: "Pull on the second glove, holding your gloved thumb away from bare skin.", why: "A gloved thumb brushing skin contaminates the glove." },
      { text: "Adjust the fingers sterile to sterile, and keep hands above the waist and in sight.", why: "Hands out of view can't be trusted as sterile.", critical: true },
      { text: "If either glove touches anything unsterile, take them off and start again with a new pair.", why: "A contaminated glove can't be cleaned.", critical: true },
    ],
    questions: [
      {
        key: "waist",
        client_need_id: "safety_infection",
        stem: "After putting on sterile gloves for a dressing change, which action by the student means the gloves are contaminated?",
        options: ABCD("Folding the gloved hands together in front of the chest", "Letting the gloved hands drop to the sides, below the waist", "Adjusting the fingers of one glove with the other gloved hand", "Picking up sterile gauze from inside the sterile field"),
        correct_option_ids: ["B"],
        rationale: "Anything below the waist is out of view and considered unsterile. The gloves must be changed.",
        option_rationales: whys(
          "Correct practice: hands above the waist and in view.",
          "Below the waist counts as contaminated.",
          "Sterile touching sterile is allowed.",
          "Items inside the field are sterile.",
        ),
      },
      {
        key: "border",
        client_need_id: "safety_infection",
        stem: "Which part of a sterile field is considered unsterile?",
        options: ABCD("The center of the field", "The 1-inch (2.5 cm) border around the edge", "Items dropped onto the field from their opened packages", "The inside of the wrapper away from the edges"),
        correct_option_ids: ["B"],
        rationale: "The outer 1-inch border is treated as contaminated because it touches the unsterile surface beneath. Everything placed correctly inside it stays sterile.",
        option_rationales: whys(
          "The center is sterile.",
          "Correct: the edge border is unsterile.",
          "Items dropped in correctly stay sterile.",
          "The inner wrapper is sterile.",
        ),
      },
    ],
  },
  {
    id: "blood_glucose",
    title: "Fingerstick glucose",
    blurb: "A clean drop, a true number, and what to do when it's low.",
    steps: [
      { text: "Check the order and timing (before meals, at bedtime), do hand hygiene and identify the client.", why: "Timing decides how the number is used, like for insulin.", critical: true },
      { text: "Check the meter's quality-control check and the strips' expiry date.", why: "An unchecked meter or old strip gives a wrong number." },
      { text: "Have the client wash with warm water and let the arm hang down.", why: "Warmth and gravity bring blood to the finger; washing removes sugar on the skin." },
      { text: "Put on gloves.", why: "Protects you from blood." },
      { text: "Puncture the side of the fingertip, not the pad.", why: "The side has fewer nerve endings, so it hurts less." },
      { text: "Wipe away the first drop if your policy says to, then touch the next drop to the strip without squeezing hard.", why: "Squeezing adds tissue fluid and dilutes the sample." },
      { text: "Press gauze on the site until it stops bleeding.", why: "Prevents bruising and bleeding." },
      { text: "Read the result, chart it, and dispose of the lancet in the sharps box.", why: "Charted values guide insulin doses." },
      { text: "Report results outside the ordered range; start the hypoglycemia protocol below 70 mg/dL.", why: "Low blood sugar can lead to seizures and unconsciousness.", critical: true },
    ],
    questions: [
      {
        key: "low",
        client_need_id: "phys_adaptation",
        stem: "A client with diabetes has a fingerstick glucose of 62 mg/dL. The client is alert and able to swallow. What should the LPN do first?",
        options: ABCD("Give 15 g of fast-acting carbohydrate, like 4 oz of juice, and recheck in 15 minutes.", "Give the scheduled insulin with the meal tray.", "Give a high-protein snack and recheck in an hour.", "Document it and recheck at the next scheduled time."),
        correct_option_ids: ["A"],
        rationale: "The 15-15 rule treats mild hypoglycemia in an alert client who can swallow: 15 g of fast carbohydrate, then recheck in 15 minutes. Report the low to the RN.",
        option_rationales: whys(
          "Correct: fast sugar first, then recheck.",
          "Insulin would drop the sugar further.",
          "Protein acts too slowly to treat a low.",
          "Waiting lets the low get worse.",
        ),
      },
      {
        key: "side",
        client_need_id: "risk_reduction",
        stem: "Why does the LPN puncture the side of the fingertip rather than the pad?",
        options: ABCD("The side bleeds more slowly.", "The side has fewer nerve endings, so it hurts less.", "The pad gives falsely high readings.", "The side is less likely to be callused in older adults."),
        correct_option_ids: ["B"],
        rationale: "The fingertip pad is packed with nerve endings; the side is less painful and still bleeds well.",
        option_rationales: whys(
          "Bleeding is similar; that isn't the reason.",
          "Correct: less pain.",
          "The site doesn't change the reading.",
          "Calluses aren't the main reason.",
        ),
      },
    ],
  },
  {
    id: "subcut_injection",
    title: "Subcutaneous injection",
    blurb: "Insulin and heparin, from the vial to the sharps box.",
    steps: [
      { text: "Check the order, the rights and allergies; for insulin, check the latest blood glucose first.", why: "A low sugar means the insulin may need to be held.", critical: true },
      { text: "Use the right syringe (an insulin syringe for insulin) and roll a cloudy insulin like NPH between your palms; don't shake it.", why: "Rolling mixes it; shaking makes bubbles and an uneven dose." },
      { text: "Have a second nurse check high-alert doses like insulin and heparin, as your policy requires.", why: "A small error with these drugs causes serious harm.", critical: true },
      { text: "Identify the client with two identifiers.", why: "Right client.", critical: true },
      { text: "Choose a site (abdomen at least 2 inches from the navel, back of the upper arm, front of the thigh) and rotate sites.", why: "Rotating prevents fatty lumps that slow absorption." },
      { text: "Clean the site with alcohol and let it dry.", why: "Wet alcohol stings and can carry into the tissue." },
      { text: "Pinch up the skin and insert at 45 to 90 degrees, depending on the needle and the client's fat layer.", why: "Places the medicine in fat, not muscle." },
      { text: "Inject slowly without aspirating, then withdraw; don't rub the site, especially after heparin.", why: "Rubbing after heparin causes bruising." },
      { text: "Activate the safety device and drop the syringe in the sharps box without recapping.", why: "Prevents needlestick injuries.", critical: true },
    ],
    questions: [
      {
        key: "heparin",
        client_need_id: "pharm",
        stem: "After giving heparin subcutaneously in the abdomen, what should the LPN do?",
        options: ABCD("Massage the site for 1 minute.", "Apply gentle pressure without massaging.", "Apply a warm pack to speed absorption.", "Aspirate before withdrawing the needle."),
        correct_option_ids: ["B"],
        rationale: "Massaging a heparin site causes bruising and tissue damage. Gentle pressure is enough; heparin isn't aspirated.",
        option_rationales: whys(
          "Massage causes bruising with heparin.",
          "Correct: light pressure only.",
          "Heat isn't used and may increase bruising.",
          "Aspiration isn't done for subcutaneous heparin.",
        ),
      },
      {
        key: "mixing",
        client_need_id: "pharm",
        stem: "The LPN is drawing up regular insulin and NPH insulin in one syringe. Which is right?",
        options: ABCD("Draw up the NPH first, then the regular.", "Draw up the regular (clear) insulin first, then the NPH (cloudy).", "Shake the NPH vial before drawing it up.", "Draw them up in separate syringes and combine them."),
        correct_option_ids: ["B"],
        rationale: "\"Clear before cloudy\" keeps NPH from getting into the regular insulin vial and changing its action. NPH is rolled, not shaken.",
        option_rationales: whys(
          "This risks NPH entering the regular vial.",
          "Correct: clear before cloudy.",
          "Shaking makes bubbles; roll it instead.",
          "Combining two syringes isn't safe practice.",
        ),
      },
    ],
  },
  {
    id: "im_injection",
    title: "IM injection (ventrogluteal)",
    blurb: "Find the V, use Z-track, and keep it in the muscle.",
    steps: [
      { text: "Check the order, the rights and allergies.", why: "Right drug, dose, route and time.", critical: true },
      { text: "Draw up the dose and choose a needle long enough to reach muscle (often 1 to 1.5 inches for an adult).", why: "Too short a needle leaves the medicine in fat." },
      { text: "Identify the client with two identifiers and explain the injection.", why: "Right client, and a relaxed muscle hurts less.", critical: true },
      { text: "Position the client on their side with the upper knee bent, or on their back.", why: "Relaxes the gluteal muscles." },
      { text: "Locate the site: heel of your hand on the greater trochanter, index finger to the front hip bone, middle finger spread toward the iliac crest; inject in the center of the V.", why: "This site is away from the sciatic nerve and large vessels.", critical: true },
      { text: "Clean the site and let it dry.", why: "Reduces microbes on the skin." },
      { text: "Pull the skin about 1 inch to the side (Z-track) and insert the needle quickly at 90 degrees.", why: "When the skin is released, the track closes and seals the medicine in the muscle." },
      { text: "Inject slowly (about 10 seconds per mL), wait 10 seconds, withdraw, then release the skin.", why: "Slow injection hurts less; the pause lets the medicine spread." },
      { text: "Don't massage; put the syringe in the sharps box without recapping and chart the site.", why: "Massage can push the medicine back up the track.", critical: true },
    ],
    questions: [
      {
        key: "site",
        client_need_id: "pharm",
        stem: "Why is the ventrogluteal site preferred for adult intramuscular injections?",
        options: ABCD("It has the thinnest layer of fat.", "It's away from major nerves and blood vessels.", "Medicine absorbs fastest there.", "Clients can give themselves injections there."),
        correct_option_ids: ["B"],
        rationale: "The ventrogluteal site is deep muscle away from the sciatic nerve and large vessels, so it's the safest large-volume site in adults.",
        option_rationales: whys(
          "Fat thickness varies; that isn't the main reason.",
          "Correct: it avoids the sciatic nerve and major vessels.",
          "The deltoid absorbs faster.",
          "It's hard to reach for self-injection.",
        ),
      },
      {
        key: "ztrack",
        client_need_id: "pharm",
        stem: "What is the purpose of the Z-track technique?",
        options: ABCD("To reduce bleeding at the site", "To seal the medicine in the muscle so it doesn't leak into tissue above", "To let the LPN inject faster", "To avoid the need to clean the skin"),
        correct_option_ids: ["B"],
        rationale: "Pulling the skin aside before injecting means the track closes when it's released, keeping irritating medicines in the muscle.",
        option_rationales: whys(
          "It isn't done to control bleeding.",
          "Correct: it seals the track.",
          "The injection is still given slowly.",
          "The site is still cleaned.",
        ),
      },
    ],
  },
  {
    id: "foley_care",
    title: "Indwelling catheter care",
    blurb: "Keep it clean, closed and draining downhill.",
    steps: [
      { text: "Do hand hygiene, identify the client, give privacy and put on gloves.", why: "Protects the client and you.", critical: true },
      { text: "Wash the perineum with soap and water.", why: "Removes secretions where bacteria grow." },
      { text: "Clean the catheter from the meatus outward, about 4 inches, in one direction.", why: "Wiping away from the body keeps bacteria from moving up the tube.", critical: true },
      { text: "Keep the catheter secured to the thigh with no pulling.", why: "Tension injures the urethra and bladder neck." },
      { text: "Keep the drainage bag below the bladder and off the floor.", why: "Urine flowing back up into the bladder causes infection.", critical: true },
      { text: "Keep the tubing free of kinks and dependent loops.", why: "Urine must drain freely." },
      { text: "Keep the system closed; never disconnect the tubing.", why: "Each opening lets bacteria in.", critical: true },
      { text: "Empty the bag at least every 8 hours or when it's two-thirds full, into the client's own container, without the spout touching it.", why: "Prevents contamination and backflow." },
      { text: "Record output and report cloudy, foul-smelling or bloody urine, or under 30 mL an hour, to the RN.", why: "These point to infection, bleeding or kidney problems.", critical: true },
    ],
    questions: [
      {
        key: "bag",
        client_need_id: "safety_infection",
        stem: "The LPN finds a client's urinary drainage bag hanging on the raised side rail, above the level of the bladder. What should the LPN do?",
        options: ABCD("Leave it there so it's easier to see.", "Move the bag to the bed frame below the bladder.", "Clamp the tubing until the bag can be moved.", "Disconnect the bag and empty it."),
        correct_option_ids: ["B"],
        rationale: "A bag above the bladder lets urine flow back and causes infection. Hang it on the bed frame, not the side rail, which moves up and down.",
        option_rationales: whys(
          "Backflow raises the infection risk.",
          "Correct: below the bladder, on the frame.",
          "Clamping blocks drainage and isn't needed.",
          "Opening the system invites infection.",
        ),
      },
      {
        key: "output",
        client_need_id: "phys_adaptation",
        stem: "A client with an indwelling catheter has had 20 mL of urine an hour for the last 2 hours. What should the LPN do?",
        options: ABCD("Increase oral fluids and check again tomorrow.", "Irrigate the catheter.", "Check the tubing for kinks and report the low output to the RN.", "Document it as the client's usual output."),
        correct_option_ids: ["C"],
        rationale: "Output under 30 mL an hour can mean dehydration, low blood flow to the kidneys or a blocked catheter. Check for a mechanical cause, then report.",
        option_rationales: whys(
          "Waiting a day delays a possibly serious problem.",
          "Irrigation needs an order.",
          "Correct: check for kinks, then report.",
          "Low output must be reported, not normalized.",
        ),
      },
    ],
  },
  {
    id: "nasal_cannula",
    title: "Oxygen by nasal cannula",
    blurb: "The ordered flow, safe skin and no open flames.",
    steps: [
      { text: "Check the order for the flow rate and target saturation, and identify the client.", why: "Oxygen is a medicine and needs an order.", critical: true },
      { text: "Make sure there's no smoking, open flame or spark-making equipment nearby.", why: "Oxygen makes fires start and spread fast.", critical: true },
      { text: "Check SpO2, breathing rate and effort before starting.", why: "A baseline shows whether the oxygen helps." },
      { text: "Connect the cannula to the flowmeter (and humidifier if ordered) and set the ordered rate, usually 1 to 6 L/min.", why: "Higher flows dry the nose and add little oxygen.", critical: true },
      { text: "Put the prongs in the nostrils curving down, loop the tubing over the ears and slide the adjuster under the chin.", why: "Keeps the cannula in place without pressure." },
      { text: "Pad the tubing over the ears and check the skin there and around the nostrils each shift.", why: "Tubing causes pressure sores." },
      { text: "Use a water-based lubricant for dry nostrils, never petroleum jelly.", why: "Petroleum products can burn with oxygen.", critical: true },
      { text: "Recheck SpO2 and breathing, and report a saturation below the target or harder breathing to the RN.", why: "The flow rate may need to change, which needs the RN and prescriber." },
      { text: "Chart the flow rate and the client's response.", why: "Shows whether the therapy is working." },
    ],
    questions: [
      {
        key: "lube",
        client_need_id: "safety_infection",
        stem: "A client on oxygen by nasal cannula says their nose feels very dry. What should the LPN use?",
        options: ABCD("Petroleum jelly", "A water-based lubricant", "Remove the cannula for an hour", "Turn the flow rate up"),
        correct_option_ids: ["B"],
        rationale: "Water-based lubricant soothes dry nares safely. Petroleum products are flammable with oxygen.",
        option_rationales: whys(
          "Flammable with oxygen.",
          "Correct: safe and soothing.",
          "Stopping ordered oxygen isn't safe.",
          "A higher flow dries the nose more and needs an order.",
        ),
      },
      {
        key: "drop",
        client_need_id: "phys_adaptation",
        stem: "A client on oxygen at 2 L/min by nasal cannula has a saturation that dropped from 95% to 88%, with a breathing rate of 28. What should the LPN do first?",
        options: ABCD("Check the cannula is in place and raise the head of the bed.", "Turn the oxygen up to 10 L/min.", "Remove the cannula and switch to room air.", "Document it and recheck in an hour."),
        correct_option_ids: ["A"],
        rationale: "First fix simple causes: a dislodged cannula or a flat position. Then report to the RN; changing the flow rate needs an order.",
        option_rationales: whys(
          "Correct: fix the simple causes, then report.",
          "10 L/min is beyond a cannula's range and needs an order.",
          "Removing oxygen makes it worse.",
          "Waiting delays care for a client getting worse.",
        ),
      },
    ],
  },
  {
    id: "bed_chair_transfer",
    title: "Bed to chair transfer",
    blurb: "Locked wheels, the strong side and a gait belt.",
    steps: [
      { text: "Check the activity order, weight-bearing limits and whether a second person or lift is needed; identify the client.", why: "Prevents falls and injury to you both.", critical: true },
      { text: "Lock the bed wheels and lower the bed to its lowest height.", why: "A moving bed causes falls.", critical: true },
      { text: "Put the chair on the client's strong side at a 45-degree angle to the bed and lock its brakes.", why: "The client steps and pivots on the strong leg.", critical: true },
      { text: "Put non-skid footwear on the client.", why: "Prevents slipping." },
      { text: "Help the client sit on the edge of the bed with feet flat, and watch for dizziness.", why: "Sitting up can drop the blood pressure.", critical: true },
      { text: "Put on a gait belt.", why: "Gives you a safe hold without pulling on the arms." },
      { text: "Stand facing the client with your feet apart and knees bent; on a count, have the client push up from the bed.", why: "A wide base and your legs, not your back, do the work." },
      { text: "Pivot toward the strong side, have the client reach for the armrest, and lower them slowly.", why: "The client controls the sit with their arms." },
      { text: "Position them comfortably with the call light in reach, and chart how they tolerated it.", why: "Safety and continuity of care." },
    ],
    questions: [
      {
        key: "strong",
        client_need_id: "safety_infection",
        stem: "A client has weakness on the left side after a stroke. Where should the LPN place the wheelchair for a transfer from bed?",
        options: ABCD("On the client's right side", "On the client's left side", "At the foot of the bed", "Wherever there is the most room"),
        correct_option_ids: ["A"],
        rationale: "The chair goes on the strong (unaffected) side so the client can bear weight and pivot on the stronger leg.",
        option_rationales: whys(
          "Correct: the right side is the strong side.",
          "The weak side can't support the pivot.",
          "This means a long, unsafe walk.",
          "Placement follows the client's strength, not space.",
        ),
      },
      {
        key: "dizzy",
        client_need_id: "risk_reduction",
        stem: "While sitting on the edge of the bed before a transfer, the client says, \"I feel dizzy.\" What should the LPN do?",
        options: ABCD("Help the client stand quickly before they get worse.", "Help the client lie back down and check the blood pressure.", "Give the client a glass of water and continue.", "Put on the gait belt and continue the transfer."),
        correct_option_ids: ["B"],
        rationale: "Dizziness when sitting up suggests orthostatic hypotension. Lie the client back down, check vital signs, and report before trying again.",
        option_rationales: whys(
          "Standing a dizzy client risks a fall.",
          "Correct: lie down and check the blood pressure.",
          "Continuing risks a fall.",
          "A gait belt doesn't prevent fainting.",
        ),
      },
    ],
  },
];

export function findSkill(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}
