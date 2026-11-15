"""
Core analysis engine for LegalGuard AI.
Splits a document into clauses, runs rule-based red-flag detection,
then (optionally) asks Groq's cloud LLM API to explain + score each clause.
"""

import os
import re
import json
from concurrent.futures import ThreadPoolExecutor
from groq import Groq
from dotenv import load_dotenv

load_dotenv()
_groq_key = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=_groq_key) if _groq_key else None
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
LLM_PARALLEL_CALLS = 5  # how many clauses are sent to the AI at the same time

SEVERITY_RANK = {"green": 0, "yellow": 1, "red": 2}


def split_into_clauses(text: str) -> list[str]:
    text = text.replace("\r\n", "\n").strip()

    # (?<!\d) stops "10." from being split into "1" + "0."
    pattern = r"(?<!\d)(?=\n?\s*(?:\d{1,2}\.\d*\s|\(\d{1,2}\)\s|Section\s\d+|Clause\s\d+|Article\s\d+))"
    parts = re.split(pattern, text)
    parts = [p.strip() for p in parts if p.strip() and len(p.strip()) > 20]

    if len(parts) >= 3:
        return parts

    paragraphs = [p.strip() for p in text.split("\n\n") if len(p.strip()) > 20]
    if len(paragraphs) >= 3:
        return paragraphs

    sentences = re.split(r"(?<=[.!?।])\s+", text)
    chunks = []
    for i in range(0, len(sentences), 3):
        chunk = " ".join(sentences[i:i + 3]).strip()
        if chunk:
            chunks.append(chunk)
    return chunks


RED_FLAG_PATTERNS = [
    (r"auto[\s-]?renew(al|s)?.{0,80}(without|no)\s+(prior\s+)?notice",
     "Auto-renewal without notice", "red",
     "This contract renews itself automatically and may not clearly warn you before it does."),

    (r"(sole|absolute)\s+discretion.{0,60}(terminate|cancel)",
     "One-sided termination rights", "red",
     "Only one party (usually not you) can end this agreement whenever they want."),

    (r"(terminate|cancel).{0,60}(sole|absolute)\s+discretion",
     "One-sided termination rights", "red",
     "Only one party (usually not you) can end this agreement whenever they want."),

    (r"(late\s+fee|penalty).{0,60}(\d{1,3}\s?%|\$\d+)",
     "Potentially excessive penalty/late fee", "yellow",
     "There's a financial penalty clause — check if the rate/amount is reasonable compared to industry norms."),

    (r"(non[\s-]?refundable|no\s+refund)",
     "Non-refundable payment", "yellow",
     "Money paid under this clause won't be returned to you, even if things change."),

    (r"(binding\s+arbitration|waive.{0,30}(right|claim)|class\s+action\s+waiver)",
     "Waiver of legal rights (forced arbitration)", "red",
     "You may be giving up your right to sue in court or join a class action lawsuit."),

    (r"(shall\s+not\s+be\s+liable|no\s+liability|limitation\s+of\s+liability).{0,100}(any|all)",
     "One-sided liability clause", "red",
     "This clause limits or removes the other party's responsibility if something goes wrong."),

    (r"(hidden|additional|extra)\s+(fee|charge|cost)",
     "Possible hidden charges", "yellow",
     "There may be extra costs not obvious at first glance."),

    (r"(indemnif(y|ication))",
     "Indemnification clause", "yellow",
     "You may be agreeing to cover the other party's legal costs or losses in certain situations."),

    (r"(security\s+deposit).{0,80}(non[\s-]?refundable|forfeit)",
     "Deposit forfeiture risk", "red",
     "Your deposit could be forfeited under certain conditions — read carefully."),

    (r"(modify|change|amend).{0,60}(at\s+any\s+time|sole\s+discretion).{0,60}(without\s+notice)?",
     "Unilateral right to change terms", "yellow",
     "The other party may be able to change the agreement's terms without asking you first."),

    (r"स्वतः\s*नवीनीकरण.{0,80}(बिना|सूचना\s*के\s*बिना)",
     "Auto-renewal without notice", "red",
     "यह अनुबंध स्वयं नवीनीकृत हो जाता है और इसके बारे में आपको पहले से सूचित नहीं किया जा सकता।"),

    (r"(पूर्ण\s*विवेकाधिकार|एकमात्र\s*विवेक).{0,60}(समाप्त|रद्द)",
     "One-sided termination rights", "red",
     "केवल एक पक्ष (आमतौर पर आप नहीं) कभी भी इस अनुबंध को समाप्त कर सकता है।"),

    (r"(विलंब\s*शुल्क|जुर्माना).{0,60}(\d{1,3}\s?%|₹\s?\d+)",
     "Potentially excessive penalty/late fee", "yellow",
     "इसमें एक वित्तीय जुर्माना खंड है — जांच लें कि यह राशि उचित है या नहीं।"),

    (r"(गैर[\s-]?वापसीयोग्य|वापसी\s*योग्य\s*नहीं|रिफंड\s*नहीं)",
     "Non-refundable payment", "yellow",
     "इस खंड के तहत भुगतान की गई राशि वापस नहीं की जाएगी, भले ही परिस्थितियाँ बदल जाएँ।"),

    (r"(बाध्यकारी\s*मध्यस्थता|अधिकार.{0,20}त्याग|अदालत.{0,20}जाने\s*का\s*अधिकार\s*नहीं)",
     "Waiver of legal rights (forced arbitration)", "red",
     "आप अदालत में मुकदमा करने या सामूहिक कार्रवाई में शामिल होने का अपना अधिकार खो सकते हैं।"),

    (r"(उत्तरदायी\s*नहीं\s*होगा|कोई\s*दायित्व\s*नहीं)",
     "One-sided liability clause", "red",
     "यह खंड कुछ गलत होने पर दूसरे पक्ष की जिम्मेदारी को सीमित या समाप्त कर देता है।"),

    (r"(छिपे\s*हुए|अतिरिक्त)\s*(शुल्क|खर्च)",
     "Possible hidden charges", "yellow",
     "इसमें ऐसे अतिरिक्त खर्च हो सकते हैं जो पहली नज़र में स्पष्ट नहीं हैं।"),

    (r"(क्षतिपूर्ति)",
     "Indemnification clause", "yellow",
     "हो सकता है कि आप कुछ स्थितियों में दूसरे पक्ष की कानूनी लागत या नुकसान की भरपाई करने पर सहमत हो रहे हों।"),

    (r"(सुरक्षा\s*जमा).{0,80}(गैर[\s-]?वापसीयोग्य|जब्त)",
     "Deposit forfeiture risk", "red",
     "आपकी जमा राशि कुछ शर्तों के तहत जब्त की जा सकती है — ध्यान से पढ़ें।"),

    (r"(संशोधित|परिवर्तन|बदलाव).{0,60}(किसी\s*भी\s*समय|एकमात्र\s*विवेक)",
     "Unilateral right to change terms", "yellow",
     "दूसरा पक्ष बिना आपसे पूछे इस अनुबंध की शर्तों को बदल सकता है।"),
]

COMPILED_PATTERNS = [(re.compile(p, re.IGNORECASE | re.DOTALL | re.UNICODE), name, sev, exp)
                      for p, name, sev, exp in RED_FLAG_PATTERNS]


def rule_based_scan(clause: str) -> list[dict]:
    hits = []
    for regex, name, severity, explanation in COMPILED_PATTERNS:
        if regex.search(clause):
            hits.append({"flag": name, "severity": severity, "explanation": explanation})
    return hits
def llm_available() -> bool:
    return groq_client is not None


def _llm_generate(prompt: str, timeout: int = 30) -> str:
    response = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        timeout=timeout,
    )
    return response.choices[0].message.content.strip()


def llm_analyze_clause(clause: str, output_language: str = "English") -> dict | None:
    """Asks the AI to judge the clause's risk itself (red/yellow/green) and explain it."""
    language_instruction = (
        "Write the summary and suggestion in Hindi (Devanagari script)."
        if output_language.lower().startswith("hi")
        else "Write the summary and suggestion in English."
    )

    prompt = f"""You are a contract-review assistant helping someone who is about to sign an agreement.
Judge how risky this single clause is for the person signing it.
The clause may be written in English, Hindi, or a mix of both.

Risk levels:
- "red": seriously unfair or dangerous for the signer (e.g. very short notice, one-sided termination, losing deposit, giving up legal rights, unlimited liability, heavy penalties)
- "yellow": worth checking or negotiating, but not seriously harmful
- "green": normal, fair, or purely informational

Clause:
\"\"\"{clause}\"\"\"

{language_instruction}

Respond ONLY with valid JSON, no other text, in this exact format:
{{"risk": "red" or "yellow" or "green", "summary": "one plain sentence explaining the clause and why it matters to the signer", "suggestion": "if risk is red or yellow, one short practical sentence on how the signer could renegotiate or soften it; if green, an empty string"}}
"""
    try:
        raw = _llm_generate(prompt)
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return None
        data = json.loads(match.group(0))
        if data.get("risk") not in ("red", "yellow", "green"):
            return None
        return data
    except Exception:
        return None


def llm_classify_document(text: str, output_language: str = "English") -> str | None:
    language_instruction = (
        "Answer in Hindi (Devanagari script), in 2-4 words only."
        if output_language.lower().startswith("hi")
        else "Answer in English, in 2-4 words only."
    )
    sample = text[:1500]
    prompt = f"""What type of legal agreement is this document? Examples: Rental Agreement, Loan Agreement,
Job Offer Letter, Insurance Policy, Terms and Conditions, Employment Contract, Service Agreement, NDA.

Document excerpt:
\"\"\"{sample}\"\"\"

{language_instruction} Respond with ONLY the document type name, nothing else."""
    try:
        raw = _llm_generate(prompt, timeout=20)
        return raw.strip().strip('"').split("\n")[0][:60]
    except Exception:
        return None


def llm_summarize_document(clause_results: list[dict], output_language: str = "English") -> str | None:
    language_instruction = (
        "Write the summary in Hindi (Devanagari script)."
        if output_language.lower().startswith("hi")
        else "Write the summary in English."
    )
    flagged = [c for c in clause_results if c["severity"] in ("red", "yellow")]
    flag_list = "; ".join(f"Clause {c['clause_number']}: {', '.join(c['flags']) or c['severity']}" for c in flagged[:10])
    if not flag_list:
        flag_list = "No significant red flags were found."

    prompt = f"""You are summarizing a contract risk analysis for a non-lawyer who is about to sign this document.

Flagged issues found: {flag_list}

Write a short 2-3 sentence plain-language summary of the overall risk in this document, and give one overall
piece of practical advice. {language_instruction}
Respond with ONLY the summary text, no labels or extra formatting."""
    try:
        raw = _llm_generate(prompt, timeout=25)
        return raw.strip()
    except Exception:
        return None


def detect_document_language(text: str) -> str:
    devanagari_chars = len(re.findall(r"[\u0900-\u097F]", text))
    if devanagari_chars == 0:
        return "English"
    ratio = devanagari_chars / max(len(text), 1)
    if ratio > 0.15:
        return "Hindi"
    return "Mixed (Hindi + English)"


def analyze_document(text: str, use_llm: bool = True, output_language: str = "English") -> dict:
    clauses = split_into_clauses(text)
    llm_on = use_llm and llm_available()
    detected_language = detect_document_language(text)

    results = []
    score_weights = {"red": 3, "yellow": 1, "green": 0}
    total_weight = 0

    # The AI judges EVERY clause, several at the same time so it stays fast.
    if llm_on and clauses:
        with ThreadPoolExecutor(max_workers=LLM_PARALLEL_CALLS) as pool:
            llm_results = list(pool.map(lambda c: llm_analyze_clause(c, output_language), clauses))
    else:
        llm_results = [None] * len(clauses)

    for i, clause in enumerate(clauses):
        rule_hits = rule_based_scan(clause)

        if any(h["severity"] == "red" for h in rule_hits):
            rule_severity = "red"
        elif any(h["severity"] == "yellow" for h in rule_hits):
            rule_severity = "yellow"
        else:
            rule_severity = "green"

        llm_result = llm_results[i]
        ai_severity = llm_result["risk"] if llm_result else None

        # Final risk = whichever (rules or AI) says it is MORE risky.
        severity = rule_severity
        if ai_severity and SEVERITY_RANK[ai_severity] > SEVERITY_RANK[rule_severity]:
            severity = ai_severity

        explanation = None
        suggestion = None
        if llm_result:
            explanation = llm_result.get("summary")
            if severity != "green":
                suggestion = llm_result.get("suggestion") or None
        elif rule_hits:
            explanation = " ".join(h["explanation"] for h in rule_hits)
        else:
            explanation = (
                "इस खंड में कोई प्रमुख जोखिम नहीं पाया गया।"
                if output_language.lower().startswith("hi")
                else "No major red flags detected in this clause."
            )

        total_weight += score_weights[severity]

        results.append({
            "clause_number": i + 1,
            "text": clause,
            "severity": severity,
            "flags": [h["flag"] for h in rule_hits],
            "explanation": explanation,
            "suggestion": suggestion,
            "rule_severity": rule_severity,
            "ai_severity": ai_severity,
            "llm_used": llm_result is not None,
        })

    max_possible = max(len(clauses) * score_weights["red"], 1)
    risk_score = round((total_weight / max_possible) * 100)

    document_type = llm_classify_document(text, output_language) if llm_on else None
    overall_summary = llm_summarize_document(results, output_language) if llm_on else None

    return {
        "clause_count": len(clauses),
        "risk_score": risk_score,
        "risk_level": "High" if risk_score >= 50 else "Medium" if risk_score >= 20 else "Low",
        "llm_enabled": llm_on,
        "detected_language": detected_language,
        "output_language": output_language,
        "document_type": document_type,
        "overall_summary": overall_summary,
        "clauses": results,
    }