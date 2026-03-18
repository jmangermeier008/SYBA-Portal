'use server';
/**
 * @fileOverview A generative AI tool for coaches to receive customized practice drill suggestions.
 *
 * - generateCustomPracticeDrills - A function that handles the generation of practice drills.
 * - GenerateCustomPracticeDrillsInput - The input type for the generateCustomPracticeDrills function.
 * - GenerateCustomPracticeDrillsOutput - The return type for the generateCustomPracticeDrills function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateCustomPracticeDrillsInputSchema = z.object({
  ageGroup: z
    .string()
    .describe(
      'The age group of the players (e.g., "U8", "U10", "High School").'
    ),
  skillLevel: z
    .string()
    .describe(
      'The skill level of the players (e.g., "Beginner", "Intermediate", "Advanced").'
    ),
  practiceFocus: z
    .string()
    .describe(
      'The primary focus of the practice session (e.g., "Dribbling", "Passing", "Shooting", "Defense", "Teamwork").'
    ),
});
export type GenerateCustomPracticeDrillsInput = z.infer<
  typeof GenerateCustomPracticeDrillsInputSchema
>;

const GenerateCustomPracticeDrillsOutputSchema = z.object({
  drillSuggestions: z.array(
    z.object({
      name: z.string().describe('The name of the practice drill.'),
      description:
        z.string().describe('A detailed description of how to perform the drill.'),
      equipment: z
        .array(z.string())
        .describe('A list of equipment needed for the drill.'),
      durationMinutes:
        z.number().describe('The estimated duration of the drill in minutes.'),
      intensity: z
        .string()
        .describe(
          'The intensity level of the drill (e.g., "Low", "Medium", "High").'
        ),
    })
  ),
});
export type GenerateCustomPracticeDrillsOutput = z.infer<
  typeof GenerateCustomPracticeDrillsOutputSchema
>;

export async function generateCustomPracticeDrills(
  input: GenerateCustomPracticeDrillsInput
): Promise<GenerateCustomPracticeDrillsOutput> {
  return generateCustomPracticeDrillsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateCustomPracticeDrillsPrompt',
  input: {schema: GenerateCustomPracticeDrillsInputSchema},
  output: {schema: GenerateCustomPracticeDrillsOutputSchema},
  prompt: `You are an experienced sports coach specializing in youth development.
Your task is to generate customized practice drill suggestions based on the provided criteria.

Player Age Group: {{{ageGroup}}}
Player Skill Level: {{{skillLevel}}}
Practice Focus: {{{practiceFocus}}}

Generate at least 3 distinct and effective drills that fit these parameters. Ensure each drill has a clear name, a detailed description, required equipment, estimated duration, and an intensity level.
`,
});

const generateCustomPracticeDrillsFlow = ai.defineFlow(
  {
    name: 'generateCustomPracticeDrillsFlow',
    inputSchema: GenerateCustomPracticeDrillsInputSchema,
    outputSchema: GenerateCustomPracticeDrillsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
