import { CONVERSATION_SETTINGS } from '@shared/presenter'

export const SEARCH_PROMPT_TEMPLATE = `
# The following content is based on the search results from the user's message:
{{SEARCH_RESULTS}}
In the search results I provided, each result is in the format [webpage X begin]...[webpage X end], where X represents the numerical index of each article. Please reference the context at the end of sentences where appropriate. Use the citation number [X] format to reference the corresponding parts in your answer. If a sentence is derived from multiple contexts, list all relevant citation numbers, such as [3][5]. Be careful not to concentrate the citation numbers at the end of the response, but rather list them in the corresponding parts of the answer.
When answering, please pay attention to the following points:

- Today is {{CUR_DATE}}
- The language of the answer should be consistent with the language of the user's message, unless the user explicitly indicates a different language for the response.
- Not all content from the search results is closely related to the user's question; you need to discern and filter the search results based on the question.
- For listing questions (e.g., listing all flight information), try to limit the answer to no more than 10 points and inform the user that they can check the search sources for complete information. Prioritize providing the most complete and relevant items; unless necessary, do not proactively inform the user that the search results did not provide certain content.
- For creative questions (e.g., writing an essay), be sure to cite the corresponding reference numbers in the body of the paragraphs, such as [3][5], and not just at the end of the article. You need to interpret and summarize the user's topic requirements, choose an appropriate format, fully utilize the search results, and extract important information to generate answers that meet the user's requirements, are deeply thoughtful, creative, and professional. Your creative length should be as long as possible, and for each point, infer the user's intent, provide as many angles of response as possible, and ensure that the information is rich and the discussion is detailed.
- If the answer is long, try to structure it and summarize it in paragraphs. If you need to answer in points, try to limit it to no more than 5 points and merge related content.
- For objective questions, if the answer to the question is very brief, you can appropriately add one or two sentences of related information to enrich the content.
- You need to choose an appropriate and aesthetically pleasing answer format based on the user's requirements and the content of the answer to ensure strong readability.
- Your answer should synthesize multiple relevant web pages and not repeat citations from a single web page.
- Use markdown to format paragraphs, lists, tables, and citations as much as possible.
- Use markdown code blocks to write code, including syntax-highlighted languages.
- Enclose all mathematical expressions in LaTeX. Always use double dollar signs $$, for example, $$x^4 = x - 3$$.
- Do not include any URLs, only include citations with numbers, such as [1].
- Do not include references (URLs, sources) at the end.
- Use footnote citations at the end of applicable sentences (e.g., [1][2]).
- Write more than 100 words (2 paragraphs).
- Avoid directly quoting citations in the answer.
- If the meaning is unclear, return the user's original query.
- Every footnote citations used in the answer must correspond to a real search results. Do not invent or hallucinate references.
- If no search results are provided currently, clearly state that no sources were given and do not use any [X] citation format in your answer.

# The user's message is:
{{USER_QUERY}}
  `

export const SEARCH_PROMPT_ARTIFACTS_TEMPLATE = `
# The following content is based on the search results from the user's message:
{{SEARCH_RESULTS}}
In the search results I provided, each result is in the format [webpage X begin]...[webpage X end], where X represents the numerical index of each article. Please reference the context at the end of sentences where appropriate. Use the citation number [X] format to reference the corresponding parts in your answer. If a sentence is derived from multiple contexts, list all relevant citation numbers, such as [3][5]. Be careful not to concentrate the citation numbers at the end of the response, but rather list them in the corresponding parts of the answer.
When answering, please pay attention to the following points:

- Today is {{CUR_DATE}}
- The language of the answer should be consistent with the language of the user's message, unless the user explicitly indicates a different language for the response.
- Not all content from the search results is closely related to the user's question; you need to discern and filter the search results based on the question.
- For listing questions (e.g., listing all flight information), try to limit the answer to no more than 10 points and inform the user that they can check the search sources for complete information. Prioritize providing the most complete and relevant items; unless necessary, do not proactively inform the user that the search results did not provide certain content.
- For creative questions (e.g., writing an essay), be sure to cite the corresponding reference numbers in the body of the paragraphs, such as [3][5], and not just at the end of the article. You need to interpret and summarize the user's topic requirements, choose an appropriate format, fully utilize the search results, and extract important information to generate answers that meet the user's requirements, are deeply thoughtful, creative, and professional. Your creative length should be as long as possible, and for each point, infer the user's intent, provide as many angles of response as possible, and ensure that the information is rich and the discussion is detailed.
- If the answer is long, try to structure it and summarize it in paragraphs. If you need to answer in points, try to limit it to no more than 5 points and merge related content.
- For objective questions, if the answer to the question is very brief, you can appropriately add one or two sentences of related information to enrich the content.
- You need to choose an appropriate and aesthetically pleasing answer format based on the user's requirements and the content of the answer to ensure strong readability.
- Your answer should synthesize multiple relevant web pages and not repeat citations from a single web page.
- Use markdown to format paragraphs, lists, tables, and citations as much as possible.
- Use markdown code blocks to write code, including syntax-highlighted languages.
- Enclose all mathematical expressions in LaTeX. Always use double dollar signs $$, for example, $$x^4 = x - 3$$.
- Do not include any URLs, only include citations with numbers, such as [1].
- Do not include references (URLs, sources) at the end.
- Use footnote citations at the end of applicable sentences (e.g., [1][2]).
- Write more than 100 words (2 paragraphs).
- Avoid directly quoting citations in the answer.
- If the meaning is unclear, return the user's original query.
- Every footnote citations used in the answer must correspond to a real search results. Do not invent or hallucinate references.
- If no search results are provided currently, clearly state that no sources were given and do not use any [X] citation format in your answer.

# Artifacts Support - MANDATORY FOR CERTAIN CONTENT TYPES
You MUST use artifacts for specific types of content. This is not optional. Creating artifacts is required for the following content types:

## REQUIRED ARTIFACT USE CASES (YOU MUST USE ARTIFACTS FOR THESE):
1. Reports and documents:
   - Annual reports, financial analyses, market research
   - Academic papers, essays, articles
   - Business plans, proposals, executive summaries
   - Any document longer than 300 words
   - Example requests: "Write a report on...", "Create an analysis of...", "Draft a document about..."

2. Complete code implementations:
   - Full code files or scripts (>15 lines)
   - Complete functions or classes
   - Configuration files
   - Example requests: "Write a program that...", "Create a script for...", "Implement a class that..."

3. Structured content:
   - Tables with multiple rows/columns
   - Diagrams, flowcharts, mind maps
   - HTML pages or templates
   - Example requests: "Create a diagram showing...", "Make a table of...", "Design an HTML page for..."

## HOW TO CREATE ARTIFACTS:
1. Identify if the user's request matches ANY of the required artifact use cases above
2. Place the ENTIRE content within the artifact - do not split content between artifacts and your main response
3. Use the appropriate artifact type:
   - markdown: For reports, documents, articles, essays
   - code: For programming code, scripts, configuration files
   - HTML: For web pages
   - SVG: For vector graphics
   - mermaid: For diagrams and charts
4. Give each artifact a clear, descriptive title
5. Include complete content without truncation
6. Still include citations [X] when referencing search results within artifacts

## IMPORTANT RULES:
- If the user asks for a report, document, essay, analysis, or any substantial written content, YOU MUST use a markdown artifact
- In your main response, briefly introduce the artifact but put ALL the substantial content in the artifact
- DO NOT fragment content between artifacts and your main response
- For code solutions, put the COMPLETE implementation in the artifact
- For documents or reports, the ENTIRE document should be in the artifact

DO NOT use artifacts for:
- Simple explanations or answers (less than 300 words)
- Short code snippets (<15 lines)
- Brief answers that work better as part of the conversation flow

# The user's message is:
{{USER_QUERY}}
`
export const DEFAULT_SETTINGS: CONVERSATION_SETTINGS = {
  systemPrompt: '',
  temperature: 0.7,
  contextLength: 12800,
  maxTokens: 8192,
  providerId: 'deepseek',
  modelId: 'deepseek-chat',
  artifacts: 0
}
