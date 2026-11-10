import { z } from "zod";
import { CLIENT_NEED_IDS, COURSE_IDS, HESI_DOMAIN_IDS, NGN_STEP_IDS } from "@/lib/blueprint-ids";

// Schemas for Claude's structured replies. Keep them free of length limits and formats:
// structured outputs only guarantee shape, so limits are enforced in code after parsing.

export const INGEST_KINDS = [
  "book_title",
  "book_cover",
  "toc_photo",
  "uworld_screenshot",
  "uworld_text",
  "notebooklm_note",
  "unknown",
] as const;
export type IngestKind = (typeof INGEST_KINDS)[number];

export const ClassificationSchema = z.object({
  kind: z.enum(INGEST_KINDS),
  confidence: z.number().describe("0 to 1"),
  book_title_guess: z.string().describe("Book title if the input names or shows a textbook, else empty"),
  isbn_guess: z.string().describe("ISBN if one is visible or typed, else empty"),
  reason: z.string().describe("One short sentence"),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const TocSchema = z.object({
  book: z.object({
    title: z.string(),
    authors: z.array(z.string()),
    edition: z.string(),
    isbn: z.string(),
  }),
  chapters: z.array(
    z.object({
      number: z.string().describe("Chapter number exactly as printed, or empty"),
      title: z.string(),
      unit_title: z.string().describe("The unit or part this chapter sits in, or empty"),
      subheadings: z.array(z.string()).describe("Section headings under the chapter, if shown"),
    }),
  ),
  looks_incomplete: z.boolean().describe("True if pages of the table of contents seem to be missing"),
});
export type Toc = z.infer<typeof TocSchema>;

const BlueprintTagSchema = z.object({
  client_need_id: z.enum(CLIENT_NEED_IDS),
  hesi_domain_id: z.enum(HESI_DOMAIN_IDS),
  relevance: z.number().describe("0 to 1: how central this category is to the lesson"),
});

export const SyllabusSchema = z.object({
  course_id: z.enum(COURSE_IDS),
  units: z.array(
    z.object({
      title: z.string(),
      modules: z.array(
        z.object({
          chapter_number: z.string(),
          title: z.string(),
          stones: z.array(
            z.object({
              title: z.string().describe("Six words or fewer"),
              summary: z.string().describe("One plain-language sentence"),
              key_topics: z.array(z.string()),
              tags: z.array(BlueprintTagSchema),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type Syllabus = z.infer<typeof SyllabusSchema>;

export const StoneTagsSchema = z.object({
  stones: z.array(z.object({ stone_index: z.number(), tags: z.array(BlueprintTagSchema) })),
});

const ChoiceSchema = z.object({ id: z.string(), text: z.string() });

// One short reason per option, right or wrong (F6).
export const OptionRationalesSchema = z
  .array(z.object({ option_id: z.string(), why: z.string().describe("One sentence") }))
  .describe("For every option: why it is right or wrong");

export const UWorldSchema = z.object({
  is_question: z.boolean().describe("False if this is not a practice question or its explanation"),
  question_type: z.enum(["single_answer", "select_all", "ngn_other"]),
  vignette: z.string(),
  choices: z.array(ChoiceSchema),
  correct_choice_ids: z.array(z.string()),
  user_choice_ids: z.array(z.string()).describe("Choices the student picked, if visible"),
  user_answer_visible: z.boolean(),
  user_missed: z.boolean().describe("True if the student's answer was wrong or the screen marks it incorrect"),
  core_takeaway: z.string().describe("One sentence"),
  trap_analysis: z.array(z.object({ choice_id: z.string(), why_wrong: z.string() })),
  topic: z.string().describe("The nursing concept tested, in a few words"),
  client_need_id: z.enum(CLIENT_NEED_IDS),
  hesi_domain_id: z.enum(HESI_DOMAIN_IDS),
  ngn_step_id: z.enum(NGN_STEP_IDS),
});
export type UWorldQuestion = z.infer<typeof UWorldSchema>;

// NGN mini bowtie: 1 likely condition (of 4), 2 actions to take (of 5), 2 parameters to monitor (of 5).
export const BowtieSchema = z.object({
  scenario: z.string(),
  condition: z.object({ prompt: z.string(), options: z.array(ChoiceSchema), correct_option_id: z.string() }),
  actions: z.object({ prompt: z.string(), options: z.array(ChoiceSchema), correct_option_ids: z.array(z.string()) }),
  parameters: z.object({ prompt: z.string(), options: z.array(ChoiceSchema), correct_option_ids: z.array(z.string()) }),
  rationale: z.string(),
});
export type Bowtie = z.infer<typeof BowtieSchema>;

export const TwinPracticeSchema = z.object({
  twin: z.object({
    stem: z.string(),
    options: z.array(ChoiceSchema),
    correct_option_ids: z.array(z.string()),
    rationale: z.string(),
    lpn_scope_note: z.string().describe("Why the right answer fits LPN/LVN scope"),
    option_rationales: OptionRationalesSchema,
  }),
  bowtie: BowtieSchema,
});
export type TwinPractice = z.infer<typeof TwinPracticeSchema>;

export const NotePearlsSchema = z.object({
  title: z.string().describe("A short title for these notes"),
  pearl_chunk_indexes: z.array(z.number()).describe("Indexes of chunks with exam pearls, mnemonics or professor tips"),
});

export const TranscriptionSchema = z.object({
  markdown: z.string(),
});

export const LessonSchema = z.object({
  eli10: z.object({
    title: z.string().describe("Six words or fewer"),
    analogy: z.string().describe("Two or three short sentences comparing the concept to everyday life, with no medical jargon"),
  }),
  lpn_core: z
    .array(z.object({ title: z.string(), bullets: z.array(z.string()).describe("At most 3 short bullets") }))
    .describe("Three sub-cards in order: what is happening in the body, signs and data to collect, LPN actions"),
  exam_alert: z.object({
    focus: z.enum(["exam_trap", "priority_rule", "early_vs_late"]),
    title: z.string(),
    bullets: z.array(z.string()).describe("At most 3 short bullets"),
  }),
  notebook_title: z.string().describe("A short title for the student's notes card, or empty when there are no notes"),
  notebook_pearls: z
    .array(
      z.object({
        note_index: z.number().describe("The [n] number of the note the quote comes from"),
        quote: z.string().describe("Copied word for word from that note"),
      }),
    )
    .describe("Up to 3 exact pearls, mnemonics or professor tips from the student's notes"),
  quiz: z
    .array(
      z.object({
        stem: z.string(),
        options: z.array(ChoiceSchema),
        correct_option_ids: z.array(z.string()),
        rationale: z.string().describe("Two sentences at most"),
        option_rationales: OptionRationalesSchema,
        ngn_step_id: z.enum(NGN_STEP_IDS),
      }),
    )
    .describe("Two new multiple-choice questions on this stone"),
  checkpoint: BowtieSchema.describe("One NGN mini bowtie on this stone"),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const CoursePlanSchema = z.object({
  summary: z.string().describe("Two sentences on how the course is paced and what it builds toward"),
  weeks: z
    .array(
      z.object({
        title: z.string().describe("Six words or fewer"),
        goals: z.array(z.string()).describe("Two to four things the student can do by the end of the week"),
        stone_refs: z.array(z.string()).describe("The S-numbers of the stones studied this week, in path order"),
      }),
    )
    .describe("Weeks in path order; every stone appears in exactly one week"),
});
export type CoursePlan = z.infer<typeof CoursePlanSchema>;

export const AskAnswerSchema = z.object({
  answer: z.string().describe("A short answer in plain language, 120 words at most"),
  in_scope: z.boolean().describe("False when the question asks about something outside LPN scope of practice"),
  cited: z.array(z.number()).describe("The [n] numbers of the sources the answer draws on"),
});
export type AskAnswerRaw = z.infer<typeof AskAnswerSchema>;

export const CARD_VERDICTS = ["agrees", "disagrees", "outdated", "out_of_scope", "no_source"] as const;

export const SourceQuoteSchema = z.object({
  source: z.number().describe("The [n] number of the source"),
  quote: z.string().describe("Words copied exactly from that source, one sentence or less"),
});

export const CardCheckBatchSchema = z.object({
  results: z.array(
    z.object({
      card: z.number().describe("The card's C-number"),
      verdict: z.enum(CARD_VERDICTS),
      confidence: z.number().describe("0 to 1: how sure the sources make you"),
      explanation: z.string().describe("One or two plain sentences for the student"),
      corrected_front: z.string().describe("For disagrees or outdated: the fixed front, else empty"),
      corrected_back: z.string().describe("For disagrees or outdated: the fixed back, else empty"),
      quotes: z.array(SourceQuoteSchema).describe("What the verdict rests on; required for agrees, disagrees and outdated"),
    }),
  ),
});
export type CardCheckBatch = z.infer<typeof CardCheckBatchSchema>;
export type CardCheckRaw = CardCheckBatch["results"][number];

export const CardSuggestionSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z.string().describe("A question or prompt, one sentence"),
        back: z.string().describe("The answer, two sentences at most"),
        quotes: z.array(SourceQuoteSchema).describe("The source words the card is built from"),
      }),
    )
    .describe("Up to three new cards"),
});
export type CardSuggestionRaw = z.infer<typeof CardSuggestionSchema>;

// ---------------------------------------------------------------------------
// Stage 6: more NGN item types, game rounds, round questions and drug cards
// ---------------------------------------------------------------------------

export const NgnSetSchema = z.object({
  matrix: z.object({
    stem: z.string(),
    columns: z.array(ChoiceSchema).describe("2 or 3 columns, such as Indicated / Not indicated"),
    rows: z.array(ChoiceSchema).describe("4 to 6 rows"),
    answers: z.array(z.object({ row: z.string(), column: z.string() })).describe("Exactly one column for every row"),
    rationale: z.string(),
    ngn_step_id: z.enum(NGN_STEP_IDS),
  }),
  cloze: z.object({
    stem: z.string(),
    text: z.string().describe("Sentences with {{1}}, {{2}} markers where each drop-down goes"),
    blanks: z.array(z.object({ id: z.string(), options: z.array(ChoiceSchema), correct_option_id: z.string() })).describe("2 or 3 blanks, 3 or 4 options each"),
    rationale: z.string(),
    ngn_step_id: z.enum(NGN_STEP_IDS),
  }),
  highlight: z.object({
    stem: z.string(),
    segments: z.array(ChoiceSchema).describe("A short nurse's note split into 6 to 10 phrases, in reading order"),
    correct_ids: z.array(z.string()),
    rationale: z.string(),
    ngn_step_id: z.enum(NGN_STEP_IDS),
  }),
  ordered: z.object({
    stem: z.string(),
    items: z.array(ChoiceSchema).describe("4 or 5 steps"),
    correct_order: z.array(z.string()).describe("Every item id, first to last"),
    rationale: z.string(),
    ngn_step_id: z.enum(NGN_STEP_IDS),
  }),
});
export type NgnSet = z.infer<typeof NgnSetSchema>;

const RoundQuestionSchema = z.object({
  stem: z.string(),
  options: z.array(ChoiceSchema),
  correct_option_ids: z.array(z.string()),
  rationale: z.string().describe("Two sentences at most"),
  option_rationales: OptionRationalesSchema,
  ngn_step_id: z.enum(NGN_STEP_IDS),
});

export const RoundQuestionsSchema = z.object({ questions: z.array(RoundQuestionSchema).describe("Two questions") });
export type RoundQuestions = z.infer<typeof RoundQuestionsSchema>;

export const MedMatchSchema = z.object({
  pairs: z
    .array(
      z.object({
        medication: z.string().describe("Generic name"),
        match: z.string().describe("Its class, main effect or key nursing action, in a few words"),
        why: z.string().describe("One sentence"),
        quote: z.string().describe("Words copied from a numbered source that back this pair, or empty"),
        source: z.number().describe("The [n] of that source, or -1"),
      }),
    )
    .describe("6 pairs, each a different medication with a different match"),
});
export type MedMatchRaw = z.infer<typeof MedMatchSchema>;

export const TriageSchema = z.object({
  setting: z.string().describe("One sentence: the unit and what the LPN is doing"),
  clients: z
    .array(
      z.object({
        summary: z.string().describe("One client in one or two sentences"),
        rank: z.number().describe("1 is seen first"),
        unstable: z.boolean().describe("True when this client needs the RN now"),
        why: z.string().describe("One sentence naming the priority rule"),
      }),
    )
    .describe("Exactly 4 clients"),
});
export type TriageRaw = z.infer<typeof TriageSchema>;

const DrugFieldSchema = z.object({
  text: z.string(),
  quote: z.string().describe("Words copied from a numbered source that back this field, or empty"),
  source: z.number().describe("The [n] of that source, or -1"),
});

export const DrugCardSchema = z.object({
  is_medication: z.boolean().describe("False when the name is not a medication"),
  name: z.string().describe("Generic name, with a common brand in parentheses"),
  drug_class: DrugFieldSchema,
  action: DrugFieldSchema,
  uses: DrugFieldSchema,
  side_effects: DrugFieldSchema,
  nursing: DrugFieldSchema.describe("What the LPN checks and does"),
  teaching: DrugFieldSchema.describe("What the LPN reinforces with the client"),
  hold_parameters: DrugFieldSchema.describe("When to hold and report, or empty text"),
  questions: z.array(RoundQuestionSchema).describe("Two NCLEX-PN style questions on this drug"),
});
export type DrugCardRaw = z.infer<typeof DrugCardSchema>;
