export type QuizLevel = "beginner" | "intermediate" | "advanced";

export type Question = {
  level: QuizLevel;
  q: string;
  opts: string[];
  ans: number;
  exp: string;
};

export type QuizDoc = {
  title: string;
  description?: string;
  questions: Question[];
  updatedAt?: unknown;
  createdAt?: unknown;
};

export function createBlankQuestion(): Question {
  return {
    level: "beginner",
    q: "",
    opts: ["", "", "", ""],
    ans: 0,
    exp: ""
  };
}

export const questions: Question[] = [
  { level: "beginner", q: "What does CSS stand for?", opts: ["Computer Style Sheets", "Cascading Style Sheets", "Creative Style System", "Colorful Style Sheets"], ans: 1, exp: "CSS stands for Cascading Style Sheets. It describes how HTML elements are displayed on screen." },
  { level: "beginner", q: "Which JavaScript keyword is used to declare a variable that cannot be reassigned?", opts: ["var", "let", "const", "static"], ans: 2, exp: "const declares a block-scoped variable that cannot be reassigned after its initial value is set." },
  { level: "beginner", q: "In HTML, which tag is used to link an external JavaScript file?", opts: ["<js>", "<link>", "<script>", "<style>"], ans: 2, exp: "The script tag with a src attribute is used to include an external JavaScript file in an HTML page." },
  { level: "beginner", q: "What is JSX in React?", opts: ["A database query language", "A syntax extension that lets you write HTML-like code in JavaScript", "A CSS framework used with React", "A testing tool for React apps"], ans: 1, exp: "JSX is a syntax extension for JavaScript that allows HTML-like markup inside JS files." },
  { level: "beginner", q: "Which of the following correctly describes props in React?", opts: ["Props are internal state values of a component", "Props are CSS styles passed to a component", "Props are read-only inputs passed from a parent to a child component", "Props are lifecycle methods in React"], ans: 2, exp: "Props are read-only data passed from parent to child components, similar to HTML attributes." },
  { level: "intermediate", q: "What is the primary purpose of React's Virtual DOM?", opts: ["To replace the browser's HTML engine", "To minimise expensive direct DOM manipulations by diffing a lightweight copy first", "To store component state between renders", "To provide server-side rendering support"], ans: 1, exp: "React keeps a Virtual DOM in memory, diffs changes, and updates only the changed parts of the real DOM." },
  { level: "intermediate", q: "Which React Hook would you use to run a side effect after every render?", opts: ["useState", "useRef", "useEffect", "useContext"], ans: 2, exp: "useEffect runs after rendering. Its dependency array controls when it runs." },
  { level: "intermediate", q: "What is prop drilling in React?", opts: ["A performance optimisation technique", "Passing props through multiple intermediate components just to reach a deeply nested one", "A way to attach default values to props", "A method for validating prop types"], ans: 1, exp: "Prop drilling means passing props through layers that do not use them just to reach a deeper child." },
  { level: "intermediate", q: "How does React.memo help performance?", opts: ["It memoises the return value of a hook", "It caches API responses", "It prevents a functional component from re-rendering if its props have not changed", "It reduces the bundle size of a React app"], ans: 2, exp: "React.memo shallow-compares props and can skip rendering when props are unchanged." },
  { level: "intermediate", q: "In React 18, what changed about state update batching?", opts: ["Batching was removed entirely", "Batching now applies only inside setTimeout", "All state updates are now automatically batched, including those inside setTimeout and fetch callbacks", "Batching is opt-in using a new hook"], ans: 2, exp: "React 18 introduced automatic batching for more update sources, reducing unnecessary renders." },
  { level: "advanced", q: "What fundamental problem did React Fiber solve compared to the old stack-based reconciler?", opts: ["Fiber added support for class components", "Fiber allows rendering to be paused, prioritised, and resumed", "Fiber introduced the Virtual DOM concept", "Fiber replaced JSX with a new templating syntax"], ans: 1, exp: "Fiber makes rendering incremental and interruptible, enabling priority-based updates and concurrent rendering." },
  { level: "advanced", q: "What is the key difference between useMemo and useCallback?", opts: ["useMemo is for class components; useCallback is for functional components", "useMemo caches the result of a function; useCallback caches the function itself", "useCallback runs asynchronously; useMemo is synchronous", "There is no difference"], ans: 1, exp: "useMemo stores a computed value. useCallback stores a function reference." },
  { level: "advanced", q: "What is a hydration mismatch in React server-side rendering?", opts: ["When the server sends an empty HTML shell", "When React cannot find the root DOM node", "When server HTML differs from what React expects to render on the client", "When CSS styles are applied before JavaScript loads"], ans: 2, exp: "Hydration mismatch happens when server-rendered HTML does not match the first client render." },
  { level: "advanced", q: "What is the purpose of the useImperativeHandle hook in React?", opts: ["It prevents a component from re-rendering imperatively", "It allows a child component to expose specific methods or values to a parent via a ref", "It updates the DOM without state", "It replaces useEffect for DOM manipulations"], ans: 1, exp: "With forwardRef, useImperativeHandle lets a child expose a controlled API through a ref." },
  { level: "advanced", q: "What technique do libraries like react-window use to render large lists efficiently?", opts: ["Server-side rendering every list item", "Lazy loading all list items at once on scroll", "Virtualisation: rendering only the items currently visible in the viewport", "Storing all list items in a Web Worker"], ans: 2, exp: "Virtualisation renders only visible DOM nodes plus a small buffer, keeping large lists fast." }
];

export function scoreForAnswer(isCorrect: boolean, startedAt?: number) {
  if (!isCorrect) return 0;
  const elapsed = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
  const speedBonus = Math.max(0, 500 - Math.floor(elapsed / 80));
  return 500 + speedBonus;
}
