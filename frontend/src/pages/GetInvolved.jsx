function GetInvolved() {
  return (
    <div className="get-involved-page py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-800 mb-6">Get Involved</h1>
          <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            Buffalo is an independent fork of SD-AI. Contributions to the fork and contributions to the upstream project are separate.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <section className="bg-white p-8 rounded-lg border border-gray-200 shadow-sm">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Buffalo fork</h2>
            <p className="text-gray-600 mb-6 leading-relaxed">
              Follow the work on infrastructure portability, project persistence and compatibility with the original engines and application. Report fork-specific issues in the Buffalo repository.
            </p>
            <a href="https://github.com/yudocyudoc/buffalo-01" className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg">Buffalo on GitHub</a>
          </section>
          <section className="bg-white p-8 rounded-lg border border-gray-200 shadow-sm">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Original SD-AI project</h2>
            <p className="text-gray-600 mb-6 leading-relaxed">
              SD-AI was developed at the University at Buffalo. Its original repository, documentation and community are maintained independently of this fork.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="https://github.com/UB-IAD/sd-ai" className="inline-block px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-lg">Upstream GitHub</a>
              <a href="https://ub-iad.github.io/sd-ai/" className="inline-block px-6 py-3 border border-gray-300 rounded-lg text-blue-600">Upstream documentation</a>
              <a href="https://groups.io/g/sd-ai/" className="inline-block px-6 py-3 border border-gray-300 rounded-lg text-blue-600">Upstream mailing list</a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default GetInvolved;
