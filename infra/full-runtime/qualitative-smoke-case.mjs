// Frozen instance of the upstream singleFeedbackLoop balancing case.
// Exact public test input and ground truth observed in #82 CI, job 139023632916.
export const CASE_ID='upstream-balancing-three-variables-v1';
export const CASE_NAME='extract a balancing feedback loop with 3 variables';
export const SCHEMA_SHA256='e1040c3a83801ee0feda28a5e0aaec6a78d5df6f0fcbdf0e9e66914446a46ea8';
export const REQUEST=Object.freeze({
 prompt:'Please find all causal relationships in the background information.',
 problemStatement:"I'm trying to do causal discovery, and extract every cause and effect relationship from the information I give you.",
 backgroundKnowledge:'fewer whoziewhats lead to more funkados. Subsequently, when there are more funkados, we typically see more maxabizers. Consequently, as maxabizers decline, whoziewhats follow suit.',
 mainTopics:'',depth:1
});
export const EXPECTED=Object.freeze([
 Object.freeze({from:'whoziewhats',to:'funkados',polarity:'-'}),
 Object.freeze({from:'funkados',to:'maxabizers',polarity:'+'}),
 Object.freeze({from:'maxabizers',to:'whoziewhats',polarity:'+'})
]);
