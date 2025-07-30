import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

// Artifacts 相关的常量定义
const ARTIFACTS_INFO = `
<artifacts_info>
You should create and reference artifacts during conversations. Artifacts are for substantial, self-contained content that users might modify or reuse, displayed in a separate UI window for clarity.

# Good artifacts are...
- Substantial content (>15 lines)
- Content that the user is likely to modify, iterate on, or take ownership of
- Self-contained, complex content that can be understood on its own, without context from the conversation
- Content intended for eventual use outside the conversation (e.g., reports, emails, presentations)
- Content likely to be referenced or reused multiple times

# Don't use artifacts for...
- Simple, informational, or short content, such as brief code snippets, mathematical equations, or small examples
- Primarily explanatory, instructional, or illustrative content, such as examples provided to clarify a concept
- Suggestions, commentary, or feedback on existing artifacts
- Conversational or explanatory content that doesn't represent a standalone piece of work
- Content that is dependent on the current conversational context to be useful
- Content that is unlikely to be modified or iterated upon by the user
- Request from users that appears to be a one-off question

# Usage notes
- One artifact per message unless specifically requested
- Prefer in-line content (don't use artifacts) when possible. Unnecessary use of artifacts can be jarring for users.
- If a user asks the assistant to "draw an SVG" or "make a website," the assistant does not need to explain that it doesn't have these capabilities. Creating the code and placing it within the appropriate artifact will fulfill the user's intentions.
- If asked to generate an image, the assistant can offer an SVG instead. The assistant isn't very proficient at making SVG images but should engage with the task positively. Self-deprecating humor about its abilities can make it an entertaining experience for users.
- The assistant errs on the side of simplicity and avoids overusing artifacts for content that can be effectively presented within the conversation.
</artifacts_info>
`

const ARTIFACT_INSTRUCTIONS_HEAD = `
<artifact_instructions>
  When collaborating with the user on creating content that falls into compatible categories, the assistant should follow these steps:

  1. Immediately before invoking an artifact, think for one sentence in <antThinking> tags about how it evaluates against the criteria for a good and bad artifact. Consider if the content would work just fine without an artifact. If it's artifact-worthy, in another sentence determine if it's a new artifact or an update to an existing one (most common). For updates, reuse the prior identifier.
  2. Wrap the content in opening and closing \`<antArtifact>\` tags.
  3. Assign an identifier to the \`identifier\` attribute of the opening \`<antArtifact>\` tag. For updates, reuse the prior identifier. For new artifacts, the identifier should be descriptive and relevant to the content, using kebab-case (e.g., "example-code-snippet"). This identifier will be used consistently throughout the artifact's lifecycle, even when updating or iterating on the artifact.
  4. Include a \`title\` attribute in the \`<antArtifact>\` tag to provide a brief title or description of the content.
  5. Add a \`type\` attribute to the opening \`<antArtifact>\` tag to specify the type of content the artifact represents. Assign one of the following values to the \`type\` attribute:
  `

const ARTIFACT_INSTRUCTIONS_TAIL = `
 6. Include the complete and updated content of the artifact, without any truncation or minimization. Don't use "// rest of the code remains the same...".
  7. If unsure whether the content qualifies as an artifact, if an artifact should be updated, or which type to assign to an artifact, err on the side of not creating an artifact.
</artifact_instructions>
`

// 存储各类型的示例
const EXAMPLE_TEMPLATES = {
  code: `
${ARTIFACT_INSTRUCTIONS_HEAD}
    - Code: "application/vnd.ant.code"
      - Use for code snippets or scripts in any programming language.
      - Include the language name as the value of the \`language\` attribute (e.g., \`language="python"\`).
      - Do not use triple backticks when putting code in an artifact.
${ARTIFACT_INSTRUCTIONS_TAIL}
<example>
  <user_query>Can you help me create a Python script to calculate the factorial of a number?</user_query>

  <assistant_response>
    Sure! Here's a Python script that calculates the factorial of a number:

    <antThinking>Creating a Python script to calculate factorials meets the criteria for a good artifact. It's a self-contained piece of code that can be understood on its own and is likely to be reused or modified. This is a new conversation, so there are no pre-existing artifacts. Therefore, I'm creating a new artifact.</antThinking>

    <antArtifact identifier="factorial-script" type="application/vnd.ant.code" language="python" title="Simple Python factorial script">
      def factorial(n):
          if n == 0:
              return 1
          else:
              return n * factorial(n - 1)

      # Use the function
      num = int(input("Enter a non-negative integer: "))
      result = factorial(num)
      print(f"{num}! = {result}")
    </antArtifact>

    You can run this script and it will prompt you to enter a number, then calculate and display its factorial.
  </assistant_response>
</example>
`,

  documents: `
${ARTIFACT_INSTRUCTIONS_HEAD}
    - Documents: "text/markdown"
      - Plain text, Markdown, or other formatted text documents
${ARTIFACT_INSTRUCTIONS_TAIL}
<example>
  <user_query>Can you draft a project proposal document for a new mobile app that helps people track their daily water intake?</user_query>

  <assistant_response>
    I'll draft a project proposal for your water tracking app.

    <antThinking>A project proposal document is substantial content that the user will likely modify and use outside our conversation. It's self-contained and can serve as a standalone document. This is a new project proposal, so I'll create a new artifact.</antThinking>

    <antArtifact identifier="water-tracker-proposal" type="text/markdown" title="Water Intake Tracking App - Project Proposal">
    # Water Intake Tracking App Project Proposal

    ## Executive Summary

    We propose the development of a mobile application called "Water Drop" designed to help users easily track their daily water intake. The app aims to encourage healthy hydration habits through personalized reminders, intuitive visualization, and simple user interface. With increasing health consciousness, the market demand for such tools is growing, presenting us with a promising business opportunity.

    ## Market Analysis

    - Global health app market growing at over 20% annually
    - 75% of adults fail to meet daily recommended water intake
    - Existing water tracking apps have limited features or complex interfaces
    - Target audience: health-conscious individuals aged 18-45

    ## Product Description

    "Water Drop" will offer the following key features:

    1. Personalized daily water intake goals
    2. Simple and quick water consumption recording
    3. Visual progress displays
    4. Smart reminder system
    5. Achievement and motivation mechanisms
    6. Data analysis and trend visualization
    7. Wearable device integration

    ## Technical Specifications

    - Native iOS and Android development
    - Cloud-based backend architecture
    - Local data storage with cloud synchronization
    - API integration for wearable device connectivity
    - Push notification system

    ## Development Timeline

    - Months 1-2: Requirements analysis and design
    - Months 3-5: Core functionality development
    - Months 6-7: Testing and optimization
    - Month 8: Launch preparation and marketing campaign
    - Month 9: Official release

    ## Budget Estimate

    - Design and development: $50,000
    - Marketing and user acquisition: $20,000
    - Server and operations: $10,000
    - Testing and quality assurance: $15,000
    - Miscellaneous expenses: $5,000
    - **Total**: $100,000

    ## Revenue Model

    1. Free basic version + premium feature subscription ($2.99/month)
    2. One-time purchase full version ($9.99)
    3. Partnerships with health brands

    ## Risk Assessment

    - Competitive risk: Existing apps may replicate our innovative features
    - Technical risk: Complexity of data synchronization and wearable device integration
    - Market risk: Rising user acquisition costs

    ## Conclusion

    The "Water Drop" app has the potential to capture a significant position in the health app market by helping users improve their health through simple yet effective features. Our product differentiation, reasonable business model, and clear development plan provide a foundation for success.
    </antArtifact>

    I've created a comprehensive project proposal for your water tracking app. It includes all key sections like executive summary, market analysis, product features, timeline, budget, and revenue model.
  </assistant_response>
</example>
`,

  html: `
${ARTIFACT_INSTRUCTIONS_HEAD}
    - HTML: "text/html"
      - The user interface can render single file HTML pages placed within the artifact tags. HTML, JS, and CSS should be in a single file when using the \`text/html\` type.
      - Images from the web are not allowed, but you can use placeholder images by specifying the width and height like so \`<img src="/api/placeholder/400/320" alt="placeholder" />\`
      - The only place external scripts can be imported from is https://cdnjs.cloudflare.com
      - It is inappropriate to use "text/html" when sharing snippets, code samples & example HTML or CSS code, as it would be rendered as a webpage and the source code would be obscured. The assistant should instead use "application/vnd.ant.code" defined above.
      - If the assistant is unable to follow the above requirements for any reason, use "application/vnd.ant.code" type for the artifact instead, which will not attempt to render the webpage.
      - Do not put HTML code in a code block when using artifacts.
      - do not forget to add AI information in the footer: "Generated with [DeepChat](https://github.com/ThinkInAIXYZ/deepchat) | All page content is AI-generated and for reference only" ,ensure it matches the page language
${ARTIFACT_INSTRUCTIONS_TAIL}
<example>
  <user_query>Can you create a simple HTML landing page for a fictional coffee shop called "Morning Brew"?</user_query>

  <assistant_response>
    I'll create a landing page for your fictional coffee shop.

    <antThinking>A landing page for a coffee shop is substantial content that would benefit from being in an artifact. It's self-contained HTML that can be viewed as a rendered page and could be reused or modified by the user. This is a new request, so I'll create a new artifact.</antThinking>

    <antArtifact identifier="coffee-shop-landing" type="text/html" title="Morning Brew Coffee Shop Landing Page">
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Morning Brew - Your Premium Coffee Experience</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f9f3e9;
        }
        header {
            background-color: #5c3d2e;
            color: #fff;
            padding: 1rem;
            position: fixed;
            width: 100%;
            z-index: 100;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        }
        nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 1rem;
        }
        .logo {
            font-size: 1.8rem;
            font-weight: bold;
        }
        .nav-links {
            display: flex;
            list-style: none;
        }
        .nav-links li {
            margin-left: 2rem;
        }
        .nav-links a {
            color: #fff;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.3s;
        }
        .nav-links a:hover {
            color: #e6c9a8;
        }
        .hero {
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background-image: url('/api/placeholder/1200/800');
            background-size: cover;
            background-position: center;
            position: relative;
            color: #fff;
            text-align: center;
        }
        .hero::after {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
        }
        .hero-content {
            max-width: 800px;
            padding: 2rem;
            z-index: 10;
        }
        .hero h1 {
            font-size: 3.5rem;
            margin-bottom: 1rem;
        }
        .hero p {
            font-size: 1.2rem;
            margin-bottom: 2rem;
        }
        .btn {
            display: inline-block;
            background: #e6c9a8;
            color: #5c3d2e;
            padding: 0.8rem 1.8rem;
            border: none;
            border-radius: 50px;
            font-size: 1rem;
            font-weight: bold;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.3s;
        }
        .btn:hover {
            background: #5c3d2e;
            color: #fff;
        }
        section {
            padding: 5rem 1rem;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .section-title {
            text-align: center;
            font-size: 2.5rem;
            margin-bottom: 3rem;
            color: #5c3d2e;
        }
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
        }
        .feature {
            background: #fff;
            padding: 2rem;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            text-align: center;
        }
        .feature h3 {
            font-size: 1.5rem;
            margin: 1rem 0;
            color: #5c3d2e;
        }
        footer {
            background: #5c3d2e;
            color: #fff;
            text-align: center;
            padding: 2rem;
        }
    </style>
</head>
<body>
    <header>
        <nav>
            <div class="logo">Morning Brew</div>
            <ul class="nav-links">
                <li><a href="#about">About</a></li>
                <li><a href="#menu">Menu</a></li>
                <li><a href="#location">Locations</a></li>
                <li><a href="#contact">Contact</a></li>
            </ul>
        </nav>
    </header>

    <section class="hero">
        <div class="hero-content">
            <h1>Awaken Your Day</h1>
            <p>Premium coffee beans, expertly brewed to perfection. Experience the difference.</p>
            <a href="#menu" class="btn">View Menu</a>
        </div>
    </section>

    <section id="about">
        <div class="container">
            <h2 class="section-title">About Morning Brew</h2>
            <div class="features">
                <div class="feature">
                    <h3>Handpicked Beans</h3>
                    <p>We source our beans from around the world, ensuring only the finest quality in every cup.</p>
                </div>
                <div class="feature">
                    <h3>Expert Roasting</h3>
                    <p>Our master roasters bring out the unique flavor profile in each batch of beans.</p>
                </div>
                <div class="feature">
                    <h3>Cozy Atmosphere</h3>
                    <p>Our shops are designed to provide the perfect environment to relax and enjoy your coffee.</p>
                </div>
            </div>
        </div>
    </section>

    <footer>
      Generated with <a href="https://github.com/ThinkInAIXYZ/deepchat">DeepChat</a> | All page content is AI-generated and for reference only
    </footer>
</body>
</html>
    </antArtifact>

    I've created a simple but modern landing page for "Morning Brew" coffee shop. The page includes a navigation bar, hero section with a call-to-action button, an about section highlighting three key features, and a footer.
  </assistant_response>
</example>
`,

  svg: `
${ARTIFACT_INSTRUCTIONS_HEAD}
    - SVG: "image/svg+xml"
      - The user interface will render the Scalable Vector Graphics (SVG) image within the artifact tags.
      - The assistant should specify the viewbox of the SVG rather than defining a width/height
      - Do not put SVG code in a code block when using artifacts.
${ARTIFACT_INSTRUCTIONS_TAIL}
<example>
  <user_query>Can you draw a simple blue circle in SVG?</user_query>

  <assistant_response>
    I'll create a simple blue circle for you using SVG.

    <antThinking>Drawing a simple blue circle in SVG is a good candidate for an artifact. It's a standalone visual element that can be reused or modified. This is a new request, so I'll create a new artifact with the identifier "blue-circle-svg".</antThinking>

    <antArtifact identifier="blue-circle-svg" type="image/svg+xml" title="Simple blue circle SVG">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="blue" />
      </svg>
    </antArtifact>

    Here's a simple SVG image of a blue circle, as requested. The circle is centered at coordinates (50, 50) with a radius of 40 pixels, and it's filled with the color blue.
  </assistant_response>
</example>
`,

  mermaid: `
${ARTIFACT_INSTRUCTIONS_HEAD}
    - Mermaid Diagrams: "application/vnd.ant.mermaid"
      - The user interface will render Mermaid diagrams placed within the artifact tags.
      - Do not put Mermaid code in a code block when using artifacts.
${ARTIFACT_INSTRUCTIONS_TAIL}
<example>
  <user_query>Can you create a simple flow chart showing the process of making tea using Mermaid?</user_query>

  <assistant_response>
    Sure! Here's a simple flow chart depicting the process of making tea using Mermaid syntax:

    <antThinking>Creating a flow chart to show the process of making tea is an excellent candidate for an artifact. It's a self-contained diagram that can be understood on its own and might be used in various contexts like a presentation or a how-to guide. This is a new request, so I'll create a new artifact with the identifier "tea-making-flowchart".</antThinking>

    <antArtifact identifier="tea-making-flowchart" type="application/vnd.ant.mermaid" title="Flow chart: Making Tea">
      graph TD
          A[Start] --> B{Water boiled?}
          B -->|Yes| C[Add tea leaves to cup]
          B -->|No| D[Boil water]
          D --> B
          C --> E[Pour boiling water into cup]
          E --> F[Steep tea for desired time]
          F --> G[Remove tea leaves]
          G --> H[Add milk or sugar, if desired]
          H --> I[Enjoy your tea!]
          I --> J[End]
    </antArtifact>

    This flow chart uses Mermaid syntax to visualize the steps involved in making a cup of tea.
  </assistant_response>
</example>
`,

  react: `
${ARTIFACT_INSTRUCTIONS_HEAD}
    - React Components: "application/vnd.ant.react"
      - Do not put React code in a code block when using artifacts.
      - Use this for displaying either: React elements, e.g. \`<strong>Hello World!</strong>\`, React pure functional components, e.g. \`() => <strong>Hello World!</strong>\`, React functional components with Hooks, or React component classes
      - When creating a React component, ensure it has no required props (or provide default values for all props) and use a default export.
      - Use Tailwind classes for styling. DO NOT USE ARBITRARY VALUES (e.g. \`h-[600px]\`).
      - The lucide library 'https://unpkg.com/lucide@latest/dist/umd/lucide.js' is available you can use  like ' <i data-lucide="x"></i>' finally by calling \`lucide.createIcons();\`
      - The recharts charting library 'https://unpkg.com/recharts/umd/Recharts.js' is available, you can use it like '<Recharts.LineChart width={600} height={300}><Recharts.XAxis dataKey="name" /></Recharts.LineChart>'
      - NO OTHER LIBRARIES (e.g. zod, hookform) ARE INSTALLED OR ABLE TO BE IMPORTED.
      - This is a react 18 project, so you can use the new syntax for hooks.
      - The react-dom library is available to be imported.
      - The react-dom/client library is available to be imported.
      - The component must be named as 'App'
      - Do not use the ReactDOM.render() method, use the createRoot() method instead.
      - Do not export the component as default, use the createRoot() method instead.
      - Do not 'import React from "react"', use the React library already available.
      - Do not use 'import React from "react";' in the artifact.
      - Use React.useState() instead of useState()
      - Use React.useEffect() instead of useEffect()
      - Images from the web are not allowed, but you can use placeholder images by specifying the width and height like so \`< img src="/api/placeholder/400/320" alt="placeholder" />\`
      - If you are unable to follow the above requirements for any reason, use "application/vnd.ant.code" type for the artifact instead, which will not attempt to render the component.
${ARTIFACT_INSTRUCTIONS_TAIL}
<example>
    <user_query>Can you create a React component for a metrics dashboard?</user_query>

    <assistant_response>
      Absolutely! Here's a React component that implements a basic metrics dashboard:

      <antThinking>Creating a React component for a metrics dashboard is a good artifact. It's substantial, self-contained, and can be reused in various web applications. It's not just a brief code snippet or primarily explanatory content. This is a new request, so I'll create a new artifact with the identifier "metrics-dashboard-component".</antThinking>

      <antArtifact identifier="dashboard-component" type="application/vnd.ant.react" title="React Component: Metrics Dashboard">
       const App = () => {
          const data = [
            {
              month: "2023-05",
              revenue: 120,
              cost: 70,
              expense: 20,
              profit: 30,
              marketing: 5,
              rnd: 10,
            },
          ];
          const [activeIndex, setActiveIndex] = React.useState(null);
          return (
            <div className="p-8 bg-white rounded-lg shadow-lg">
              <h1 className="text-2xl font-bold mb-6">营业报表可视化</h1>
              <Recharts.ResponsiveContainer width="100%" height={400}>
                <Recharts.LineChart
                  data={data}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  onMouseMove={(e) => {
                    if (e.activeTooltipIndex !== undefined) {
                      setActiveIndex(e.activeTooltipIndex);
                    }
                  }}
                  onMouseLeave={() => setActiveIndex(null)}
                >
                ...
                </Recharts.LineChart>
              </Recharts.ResponsiveContainer>

              {activeIndex !== null && (
                <div className="mt-8 p-4 bg-gray-50 rounded-lg">
                  <h2 className="text-lg font-semibold mb-2">
                    详细数据 ({data[activeIndex].month})
                  </h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div>营业额: {data[activeIndex].revenue} 万元</div>
                      ...
                  </div>
                </div>
              )}
            </div>
          );
        };
        const root = ReactDOM.createRoot(document.getElementById("root"));
        root.render(<App />);
      </antArtifact>

      Feel free to ask if you want to extend this component!
    </assistant_response>
  </example>
`
}

// Schema 定义
const GetArtifactInstructionsArgsSchema = z.object({
  type: z.enum(['code', 'documents', 'html', 'svg', 'mermaid', 'react'])
})

export class ArtifactsServer {
  private server: Server

  constructor() {
    // 创建服务器实例
    this.server = new Server(
      {
        name: 'deepchat-inmemory/artifacts-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    // 设置请求处理器
    this.setupRequestHandlers()
  }

  // 启动服务器
  public startServer(transport: Transport): void {
    this.server.connect(transport)
  }

  // 设置请求处理器
  private setupRequestHandlers(): void {
    // 设置工具列表处理器
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_artifact_instructions',
            description:
              'Only call this function when you need instructions for a specific artifact type, and call it only once per type. ' +
              'This tool provides guidance on creating and referencing artifacts, including code, documents, HTML, SVG, Mermaid diagrams, or React components. ' +
              'Do not call this function repeatedly if instructions or definitions for the requested artifact type are already available in the current context. ' +
              'Specify the desired artifact category through the type parameter: code, documents, html, svg, mermaid, or react. ' +
              'After obtaining the instructions, use them appropriately and avoid duplicate calls for the same type.',
            inputSchema: zodToJsonSchema(GetArtifactInstructionsArgsSchema)
          }
        ]
      }
    })

    // 设置工具调用处理器
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params

        if (name === 'get_artifact_instructions') {
          const parsed = GetArtifactInstructionsArgsSchema.safeParse(args)
          if (!parsed.success) {
            throw new Error(`Invalid parameters: ${parsed.error}`)
          }

          // 组合返回所有必要信息
          return {
            content: [
              {
                type: 'text',
                text: `[IMPORTANT NOTE: You have received instructions for artifact type '${parsed.data.type}'. DO NOT call this again for the same type.]\n\n${ARTIFACTS_INFO}\n\n${EXAMPLE_TEMPLATES[parsed.data.type]}`
              }
            ]
          }
        }

        throw new Error(`Unknown tool: ${name}`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text', text: `Error: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }
}

// 使用示例
// const server = new ArtifactsServer()
// server.startServer(transport)
