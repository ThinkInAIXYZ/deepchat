# Create Skill Prompt

> This file contains the complete SKILL.md content for the `create-skill` skill, guiding AI Agent to create new Skills.

---

## Complete SKILL.md Content

```markdown
---
name: create-skill
description: Create and edit DeepChat Skills. Use when users want to create a new skill, update an existing skill, or ask how to write a skill.
---

# Skill Creation Guide

This skill guides you through creating effective DeepChat Skills.

## About Skills

Skills are modular file packages that extend AI Agent capabilities by providing specialized knowledge, workflows, and tool integrations. Think of them as domain-specific "onboarding guides" — transforming a general-purpose Agent into a specialist equipped with procedural knowledge.

### What Skills Provide

1. **Specialized workflows** - Multi-step processes for specific domains
2. **Tool integrations** - Guidance for specific file formats or APIs
3. **Domain expertise** - Company-specific knowledge, patterns, business logic
4. **Bundled resources** - Scripts, reference docs for complex tasks

## Core Principles

### Conciseness First

The context window is a shared resource. Skills compete with system prompts, conversation history, other Skills metadata, and user requests.

**Default assumption: AI Agent already has significant capabilities.** Only add context it doesn't already have. Question each piece of information: "Is this explanation really needed?" "Does this paragraph justify its token cost?"

Prefer concise examples over verbose explanations.

### Control Degrees of Freedom

Match specificity level to task fragility and variability:

| Freedom | Scenario | Expression |
|---------|----------|------------|
| **High** | Multiple approaches valid, decisions depend on context | Text instructions |
| **Medium** | Preferred pattern exists, some variation allowed | Pseudocode or parameterized scripts |
| **Low** | Operations fragile and error-prone, consistency critical | Specific scripts, few parameters |

Imagine exploring a path: a narrow bridge over cliffs needs precise guardrails (low freedom), while an open field allows many routes (high freedom).

### Progressive Loading

Skills use a three-level loading system for efficient context management:

1. **Metadata (name + description)** - Always in context (~100 words)
2. **SKILL.md body** - Loaded when skill activates (<5k words)
3. **Bundled resources** - Loaded on demand (unlimited, scripts execute without loading into context)

## Skill Structure

Each skill consists of a required SKILL.md file and optional supporting files:

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (required)
│   │   ├── name: (required)
│   │   └── description: (required)
│   └── Markdown instructions (required)
└── Supporting Files (optional, any organization)
    ├── *.md          - Reference documentation
    ├── *.sh / *.py   - Executable scripts
    └── any-folder/   - Organize as needed
```

**Note**: File organization is flexible. Use whatever structure makes sense for your skill. Common patterns include `references/`, `scripts/`, `docs/`, or flat files.

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Unique identifier, must match directory name |
| `description` | string | ✅ | Purpose and trigger conditions, used for semantic matching |
| `allowedTools` | string[] | ❌ | Additional tools needed |

### Path Variables

| Variable | Description |
|----------|-------------|
| `${SKILL_ROOT}` | Current skill's root directory path |
| `${SKILLS_DIR}` | Skills root directory path |

### Supporting Files

You can organize supporting files however makes sense. Common patterns:

**Pattern A: Flat files**
```
my-skill/
├── SKILL.md
├── schema.md
├── examples.md
└── helper.sh
```

**Pattern B: Grouped by type**
```
my-skill/
├── SKILL.md
├── references/
│   ├── api.md
│   └── schema.md
└── scripts/
    └── validate.sh
```

**Pattern C: Grouped by domain**
```
my-skill/
├── SKILL.md
├── finance/
│   └── metrics.md
├── sales/
│   └── pipeline.md
└── common.md
```

Reference files in SKILL.md using `${SKILL_ROOT}`:
```markdown
See [schema.md](${SKILL_ROOT}/schema.md) for database structure.
```

### What NOT to Include

Skills should only contain files essential to their functionality. Do not create extraneous documentation:

- ❌ README.md
- ❌ CHANGELOG.md
- ❌ INSTALLATION_GUIDE.md
- ❌ Test and debug files

## Creation Process

### Step 1: Understand Requirements

Gather concrete use cases and examples. Key questions:

- "What functionality should this skill support?"
- "Can you give some usage examples?"
- "What would users say that should trigger this skill?"

Avoid asking too many questions in a single message. Start with the most important, follow up as needed.

**Completion criteria**: Clear understanding of what functionality the skill should support.

### Step 2: Plan Content

Analyze each use case:

1. What steps are needed to execute this use case from scratch?
2. What scripts/references would help when repeatedly executing these workflows?

**Example analysis**:

| Use Case | Analysis | Resource |
|----------|----------|----------|
| "Help me rotate this PDF" | Rotating PDF requires rewriting same code each time | `scripts/rotate_pdf.sh` |
| "Query how many users logged in today" | Querying requires rediscovering table schemas each time | `references/schema.md` |

### Step 3: Initialize Directory

**Skill naming convention**: Use verb-first names that clearly communicate the action:

- ✅ Good: `create-report`, `analyze-logs`, `deploy-app`
- ❌ Bad: `report-creator`, `log-analyzer`, `app-deployer`

**Create directory structure**:

```bash
mkdir -p ${SKILLS_DIR}/skill-name/{scripts,references}

cat > ${SKILLS_DIR}/skill-name/SKILL.md << 'EOF'
---
name: skill-name
description: TODO - Describe what this skill does and when to use it
---

# Skill Name

TODO - Add skill instructions
EOF
```

### Step 4: Write Content

#### Frontmatter

- `name`: Skill name, must match directory name
- `description`: This is the primary triggering mechanism for the skill
  - Include what the skill does and when to use it
  - All "when to use" information goes here, not in the body
  - The body is only loaded after activation, so "When to Use This Skill" sections in the body are ineffective

**description example**:
```yaml
description: Review code changes according to team standards, checking code quality, security, and maintainability. Use when users request code review, PR review, or want feedback on their code.
```

#### Body

- Use imperative/infinitive form
- Keep under 500 lines
- Clearly reference files and specify when to read them

#### Progressive Loading Patterns

**Pattern 1: High-level guide + references**

```markdown
# PDF Processing

## Quick Start

Extract text using pdfplumber:
[code example]

## Advanced Features

- **Form filling**: See [FORMS.md](${SKILL_ROOT}/references/FORMS.md)
- **API reference**: See [REFERENCE.md](${SKILL_ROOT}/references/REFERENCE.md)
```

**Pattern 2: Domain-based organization**

```
bigquery-skill/
├── SKILL.md (overview and navigation)
└── references/
    ├── finance.md (finance related)
    ├── sales.md (sales related)
    └── product.md (product related)
```

When user asks about sales metrics, only read sales.md.

### Step 5: Test

After skill creation, **suggest user start a new session** to test. Skills load at session start, newly created skills are not available in current session.

**Iteration workflow**:

1. Use skill on real tasks
2. Notice difficulties or inefficiencies
3. Identify how SKILL.md or resources should be updated
4. Implement changes and test again

## Complete Example

### Code Review Skill

```
code-review/
├── SKILL.md
└── references/
    ├── checklist.md
    └── style-guide.md
```

**SKILL.md**:

```markdown
---
name: code-review
description: Review code changes according to team standards, checking code quality, security, and maintainability. Use when users request code review, PR review, or want feedback on their code.
allowedTools:
  - Read
  - Grep
  - Glob
---

# Code Review

## Review Process

1. Use `git diff` to see scope of changes
2. Read ${SKILL_ROOT}/references/checklist.md for check items
3. Review each code change
4. Output structured review report

## Resources

- Checklist: ${SKILL_ROOT}/references/checklist.md
- Style Guide: ${SKILL_ROOT}/references/style-guide.md

## Output Format

For each finding, use this format:
- **Location**: file:line
- **Level**: 🔴 Critical | 🟡 Suggestion | 🟢 Optimization
- **Description**: Issue description
- **Suggestion**: Fix recommendation
```

## Troubleshooting

### Skill Not Triggering

Check if `description` contains keywords users might use. Description should answer:
1. What does this skill do?
2. When should it be used?

### Skill Fails to Load

Check:
- YAML frontmatter syntax is correct
- `name` matches directory name
- File paths are correct

### Multiple Skills Conflict

If Agent uses wrong skill, descriptions are too similar. Make descriptions more specific with different trigger terms.
```

---

## Key Design Decisions

### 1. No Dedicated Tools

Creating a skill is essentially file operations, existing tools suffice:
- `Bash`: Create directories with `mkdir -p`
- `Write`: Write SKILL.md
- `Read`: Read existing skills
- `Edit`: Modify skills

### 2. Simplified from Forge

| Simplification | Reason |
|----------------|--------|
| Removed project/global level selection | DeepChat currently only supports user level |
| Removed assets/ directory | Currently unsupported, use references/ instead |
| Removed template variables | Use ${SKILLS_DIR} directly |
| Removed external reference files | All content inlined in SKILL.md |

### 3. Preserved Core Value

- Progressive loading design principles
- Token optimization awareness
- Degrees of freedom framework
- Complete creation process

---

## Future Iteration Directions

1. **Add references/ files**: If SKILL.md becomes too long, split out skill-format.md and design-patterns.md
2. **Support templates**: Pre-built common skill templates (code review, doc generation, etc.)
3. **Validation script**: Add scripts/validate.sh to validate SKILL.md format
