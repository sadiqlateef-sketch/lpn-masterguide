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
        ngn_step_id: z.enum(NGN_STEP_IDS),
      }),
    )
    .describe("Two new multiple-choice questions on this stone"),
  checkpoint: BowtieSchema.describe("One NGN mini bowtie on this stone"),
});
export type Lesson = z.infer<typeof LessonSchema>;
