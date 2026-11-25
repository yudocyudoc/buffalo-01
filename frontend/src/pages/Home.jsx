import { Link } from 'react-router-dom';

function Home() {
  return (
    <div className="homepage">
      {/* Hero Section */}
      <div className="min-h-screen flex flex-col justify-center items-center text-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-700 mb-4">Independent SD-AI fork</p>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 text-gray-800 leading-tight">
            Buffalo
          </h1>
          <p className="text-xl sm:text-2xl text-gray-600 max-w-4xl mx-auto mb-6 leading-relaxed">
            Buffalo is an independently maintained fork of SD-AI that aims to run the original engines, agents and application code on alternative infrastructure, with durable project state and continuity across sessions and restarts. The initial implementation targets Cloudflare; the goal is portability while preserving upstream behavior and minimizing changes to the original code.
          </p>
          <p className="text-base text-gray-600 max-w-3xl mx-auto mb-10 leading-relaxed">
            Based on the open-source <a href="https://github.com/UB-IAD/sd-ai" className="text-blue-600 hover:underline">SD-AI project</a> developed at the University at Buffalo.
            This fork is not an official university project and does not claim affiliation, funding, sponsorship or endorsement by the upstream project or its partners.
            The <a href="https://ub-iad.github.io/sd-ai/" className="text-blue-600 hover:underline">original documentation</a> remains available separately.
          </p>
          {/* Engines, Agents, and Evaluations Introduction */}
          <div className="bg-gradient-to-r from-blue-50 to-green-50 p-8 sm:p-10 rounded-xl max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-12">
              <div className="text-center flex flex-col">
                <p className="text-gray-600 leading-relaxed mb-4 flex-1">
                  SD-AI has a growing list of engines for tasks like creating causal loop diagrams and simulating models.
                </p>
                <Link
                  to="/engines"
                  className="inline-block px-6 py-3 bg-blue-600 text-white no-underline rounded-lg text-base font-semibold border-none cursor-pointer hover:bg-blue-700"
                >
                  Explore Engines
                </Link>
              </div>

              <div className="text-center flex flex-col">
                <p className="text-gray-600 leading-relaxed mb-4 flex-1">
                  It also hosts conversational agents that guide you through the modeling process step by step.
                </p>
                <Link
                  to="/agents"
                  className="inline-block px-6 py-3 bg-indigo-600 text-white no-underline rounded-lg text-base font-semibold border-none cursor-pointer hover:bg-indigo-700"
                >
                  Explore Agents
                </Link>
              </div>

              <div className="text-center flex flex-col">
                <p className="text-gray-600 leading-relaxed mb-4 flex-1">
                  For each type of engine there is also a set of quality tests (called evals) used to benchmark performance of the engine.
                </p>
                <Link
                  to="/evals"
                  className="inline-block px-6 py-3 bg-green-600 text-white no-underline rounded-lg text-base font-semibold border-none cursor-pointer hover:bg-green-700"
                >
                  View Evaluations
                </Link>
              </div>

              <div className="text-center flex flex-col">
                <p className="text-gray-600 leading-relaxed mb-4 flex-1">
                  The inherited SD-AI leaderboards document upstream benchmark results by modeling task.
                </p>
                <Link
                  to="/leaderboards"
                  className="inline-block px-6 py-3 bg-purple-600 text-white no-underline rounded-lg text-base font-semibold border-none cursor-pointer hover:bg-purple-700"
                >
                  View Leaderboards
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content Sections */}
      <div className="px-4 py-12 sm:px-6 lg:px-8">

      {/* Fork goals */}
      <section className="mb-20 sm:mb-24">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10 text-gray-800">
          Goals of the fork
        </h2>
        <div className="bg-white p-8 sm:p-10 rounded-xl border-2 border-gray-200 shadow-sm">
          <ul className="list-disc pl-5 space-y-4 text-gray-600 leading-relaxed">
            <li>Preserve the original SD-AI engines, agents, model formats and API contracts wherever possible.</li>
            <li>Make the original application runnable on alternative hosting infrastructure, initially Cloudflare.</li>
            <li>Support durable, project-scoped models, revisions, simulation runs, conversations and associated evidence across sessions and restarts.</li>
            <li>Keep infrastructure adapters and persistence separate from the modeling logic, and validate compatibility with upstream tests and reference cases.</li>
          </ul>
          <p className="mt-6 text-gray-600 leading-relaxed">
            Buffalo is under development. The inherited engine catalog, evaluations and leaderboard results are not proof of complete fork parity or independently reproduced benchmark performance.
            This website is static documentation, not the operational modeling application.
          </p>
          <p className="mt-4 text-gray-600">
            <a href="https://github.com/yudocyudoc/buffalo-01" className="text-blue-600 hover:underline">Fork repository</a>
            {' · '}
            <a href="https://github.com/yudocyudoc/buffalo-01/blob/main/infra/full-runtime/README.md" className="text-blue-600 hover:underline">Runtime implementation and validation</a>
          </p>
        </div>
      </section>

      {/* Getting Started Section */}
      <div className="mb-20 sm:mb-24">
        <div className="bg-gradient-to-r from-blue-50 to-green-50 p-8 sm:p-10 rounded-xl">
          <div className="bg-white p-8 rounded-lg shadow-sm">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4 text-gray-800 text-center">
              Start Experimenting!
            </h2>
            <p className="text-gray-600 leading-relaxed mb-6 text-lg text-center max-w-4xl mx-auto">
              The original SD-AI project supports AI-assisted modeling in applications such as{' '}
              <a 
                href="https://www.iseesystems.com/store/products/stella-architect.aspx" 
                className="text-blue-600 hover:underline font-medium"
                target="_blank"
                rel="noopener noreferrer"
              >
                Stella
              </a>
              {' '}(version 4.0 or above) or{' '}
              <a 
                href="https://comodel.io" 
                className="text-blue-600 hover:underline font-medium"
                target="_blank"
                rel="noopener noreferrer"
              >
                CoModel
              </a>
              , or explore the{' '}
              <Link
                to="/engines"
                className="text-blue-600 hover:underline font-medium"
              >
                engines
              </Link>
              ,{' '}
              <Link
                to="/agents"
                className="text-blue-600 hover:underline font-medium"
              >
                agents
              </Link>
              , and{' '}
              <Link
                to="/evals"
                className="text-blue-600 hover:underline font-medium"
              >
                evaluations
              </Link>
              {' '}documented on this site.
            </p>
          </div>
        </div>
      </div>

      {/* Get Involved CTA */}
      <div className="mb-20 sm:mb-24 text-center">
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-8 sm:p-10 rounded-xl border-2 border-blue-100">
          <h2 className="text-2xl sm:text-3xl font-bold mb-6 text-gray-800">
            Ready to Get Involved?
          </h2>
          <p className="text-base sm:text-lg text-gray-600 mb-8 max-w-2xl mx-auto leading-relaxed">
            Explore the independent fork or visit the original SD-AI community.
          </p>
          <Link 
            to="/get-involved"
            className="inline-block px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white no-underline rounded-lg text-lg font-semibold border-none cursor-pointer hover:from-blue-700 hover:to-purple-700 shadow-lg hover:shadow-xl"
          >
            Repositories and Contributions
          </Link>
        </div>
      </div>
      </div>
    </div>
  );
}

export default Home;
