const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzS8AAAAASUVORK5CYII=';
const writing = { version: 1, profile: 'language-quality', task: 'Write about your routine.', responses: [{ id: 'answer', format: 'text', language: 'es', value: 'Yo vive en Trondheim.' }], learner: { level: 'Spanish course 1' }, feedback: { language: 'en', mode: 'review', maxIssues: 3, allowFullRewrite: false } };
module.exports = {
  png, writing,
  translation: { ...writing, profile: 'translation', task: 'Translate the source into Spanish.', materials: [{ id: 'source', role: 'source', language: 'en', text: 'I live in Trondheim.' }] },
  mathematics: { task: 'Calculate the area of a circle of radius 3.', profile: 'mathematics', responses: [{ id: 'area', format: 'latex', value: '6*pi' }], evidence: [{ label: 'area', text: 'incorrect' }], feedback: { language: 'nb', mode: 'hints', steps: ['Ask a diagnostic question.', 'Name the relevant concept.', 'Describe the procedure.', 'Show a solution.'], level: 1 } },
  python: { task: 'Implement add(a,b). Do not import modules.', profile: 'python', responses: [{ id: 'code', format: 'code', language: 'python', value: 'def add(a,b): return a-b' }], evidence: [{ label: 'checks', text: '1 of 3 checks passed. Output is current.' }] },
  image: { task: 'Review this handwritten Spanish. Do not guess unreadable words.', profile: 'language-quality', responses: [], attachments: [{ id: 'work', role: 'response', label: 'handwritten Spanish', dataUrl: png }], feedback: { language: 'en' } }
};
