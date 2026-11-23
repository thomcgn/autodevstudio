/** Lightweight deterministic classroom-language review of generated lessons.
 * This is not a substitute for semantic code verification or a human educator.
 */
export interface PedagogicalReview {
 readonly passed:boolean;readonly findings:readonly string[];
}
export interface ReviewableLesson {
 readonly problem:string;readonly walkthrough:string;readonly implementation:string;
 readonly reasoning:string;readonly title:string;
}
const englishMarkers=/\b(?:the|and|while|would|should|could|with|without|into|from|requires|allows|metadata|configuration|defaults|persistent|storage|linked|between|application)\b/gi;
const technicalTerms=/\b(?:EnumMap|JPA|ORM|DTO|lazy.loading|foreign.key|dependency.injection|hibernate|serialization|polymorphism)\b/gi;
function terms(value:string,expression:RegExp):number{return [...value.matchAll(expression)].length;}
export function reviewBeginnerLesson(lesson:ReviewableLesson):PedagogicalReview {
 const findings:string[]=[];
 for(const section of ['problem','walkthrough'] as const){
  const text=lesson[section].trim();
  if(text.length<35)findings.push(section+': Erklärung zu knapp für einen Einstieg');
  if(terms(text,englishMarkers)>=3)findings.push(section+': überwiegend englische Erklärung statt Deutsch');
 }
 const opening=lesson.problem.split(/[.!?]\s/).slice(0,2).join(' ');
 if(terms(opening,technicalTerms)>=2)
  findings.push('problem: mehrere unerklärte Fachbegriffe direkt am Kapitelanfang');
 if(lesson.title.trim().length<8)findings.push('title: Überschrift ist nicht aussagekräftig');
 return {passed:findings.length===0,findings};
}
