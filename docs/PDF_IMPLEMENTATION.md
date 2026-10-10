# USCIS PDF implementation readiness

Read-only audit: October 10, 2026. No USCIS PDF was modified or generated in this audit.

## Current behavior and coverage

The catalog lists 21 documents. `data/preparation-fields.json` has 143 introductory answer fields, not a complete filing interview. `src/screens/FormsFlow.tsx` opens the official PDF URL for the free path; it does not embed a tested editor, fill a PDF, generate a completed packet, or submit to USCIS. The AI path currently produces an editable local answer draft. Adding a live language model does not close the PDF or interview coverage gaps.

| Document | Catalog scope | Introductory answer fields |
| --- | --- | ---: |
| AR-11 | Primary | 6 |
| G-1145 | Primary | 5 |
| G-639 | Official resource | 7 |
| I-90 | Primary | 6 |
| I-129F | Primary | 7 |
| I-130 | Primary | 7 |
| I-130A | Related to I-130 | 7 |
| I-131 | Primary | 7 |
| I-131A | Primary | 7 |
| I-134 | Primary | 7 |
| I-485 | Primary | 7 |
| I-751 | Primary | 7 |
| I-765 | Primary | 7 |
| I-765WS | Related worksheet | 6 |
| I-821 | Official resource | 7 |
| I-821D | Primary | 7 |
| I-864 | Primary | 7 |
| I-864A | Related contract | 7 |
| N-400 | Primary | 7 |
| N-565 | Primary | 7 |
| N-600 | Primary | 8 |

Catalog inclusion must remain separate from a supported paid preparation service. In particular, related documents are not necessarily standalone packages and the G-639/I-821 resource entries are not evidence of a working preparation service.

## Independently verified template facts

The official landing pages and PDF files were retrieved successfully with an ordinary HTTP client on the audit date. The web reader returned 403, so its failure alone should not be reported as the documents being unavailable. Recheck edition acceptance and alerts on the official landing page before enabling an export; a successful PDF download alone does not establish that edition acceptance is unchanged.

| Check | I-90 | I-129F |
| --- | --- | --- |
| Official landing page | [USCIS I-90](https://www.uscis.gov/i-90) | [USCIS I-129F](https://www.uscis.gov/i-129f) |
| Official blank PDF | [i-90.pdf](https://www.uscis.gov/sites/default/files/document/forms/i-90.pdf) | [i-129f.pdf](https://www.uscis.gov/sites/default/files/document/forms/i-129f.pdf) |
| Official instructions | [i-90instr.pdf](https://www.uscis.gov/sites/default/files/document/forms/i-90instr.pdf) | [i-129finstr.pdf](https://www.uscis.gov/sites/default/files/document/forms/i-129finstr.pdf) |
| Landing-page edition and PDF footer | 01/20/25 | 01/20/25 |
| PDF pages / instruction pages | 7 / 11 | 12 / 14 |
| Page size | US Letter, 612 x 792 points | US Letter, 612 x 792 points |
| AcroForm root fields / terminal fields | 1 / 195 | 1 / 445 |
| Page Widget annotations | 195 | 445 |
| Terminal field types | 111 text, 78 button, 6 choice | 289 text, 140 button, 16 choice |
| XFA and PDF JavaScript | Present | Present |
| PDF SHA-256 | `fd436062284fd572224509e0e17a795f915734f7e7c0fca8a161d0a9976f83a0` | `a130977a518cbea52ced097c4e95aac9655a1c6d4342eafe2ccfb7c2fb31e881` |

Counts describe PDF structure, not the number of required user answers. They include repeating, conditional and machine fields such as barcode widgets. Every inspected widget has a `/Parent`; this does not call for blindly adding duplicate fields with `reattach_fields()`.

Both files use AES encryption/permission metadata and open for ordinary reading without asking for a password. Poppler reports printing allowed, general modification disallowed, and notes allowed; its copy flag differs between the two templates. Do not infer fill/edit compatibility from these summary permission flags. No permissions, XFA packets, usage rights, barcodes, scripts or signatures were removed or changed in this audit.

**Observed library blocker:** bundled `pypdf 6.10.0` raises `ValueError: Invalid padding bytes` while reading either original template's field tree. `pdfplumber` and Poppler read them successfully. This is a reproducible compatibility issue with the tested files/library, not a conclusion that the forms cannot be filled. A document-engine compatibility spike is needed before choosing the production PDF engine. Do not silently remove XFA or bypass errors and call the resulting output complete.

The first page of each original template was rendered and visually inspected. A full render/export check still belongs to the implementation gate. The local Poppler runtime emitted font-cache configuration errors during rendering; fix its writable cache/font configuration before relying on automated visual regression runs.

## First full implementation: I-90

I-90 is a more bounded first complete application than I-129F. This is an engineering sequencing choice, not an eligibility recommendation.

The six existing answers cover a name, birth date, mailing address, birth country, card description and replacement reason. They do not map directly to the official structured fields. The implementation needs, at minimum:

- Separate name components and prior-card name, structured domestic/international addresses, applicable account/identification numbers, birth details, parents' names, admission details and contact details.
- Explicit application-status and reason selections with their conditional follow-ups. A free-text replacement reason cannot safely determine which official checkbox should be marked without confirmation.
- Processing-history disclosures, biographic fields, accommodations, interpreter/preparer sections, statements and additional-information continuation blocks.
- Applicable supporting-document checklist and filing instructions tied to the reviewed reason and current official instructions. Signature/date areas require an explicit user signing workflow; AI must not sign or invent attestations.

The existing five-question I-90 check is a preliminary routing screen. It does not establish all filing requirements or confirm continuing resident status. Keep uncertain or exceptional cases in a review state; do not make a general immigration-ineligibility decision from these answers.

I-129F is a separate complete mapping/interview project. Its seven introductory answers omit substantial petitioner and beneficiary histories, prior marriages, citizenship details, children, immigration/document details, relationship evidence, IMBRA/criminal-history disclosures, waivers, interpreter/preparer information and continuation pages. K-3 and exception cases already route to review; a generic AI reply must not override that routing.

## Concrete implementation stages

1. **Template registry and engine proof.** Record official URLs, edition, acceptance-check date, immutable hash, page count, complete hierarchical field names, widget locations, types, options/export values and read-only/internal fields. For I-90, fill synthetic text, date, choice and checkbox cases in a temporary output using an engine demonstrated to preserve the relevant structure and appearances. Resolve XFA/AcroForm consistency and barcode behavior explicitly. Preserve the original template. Do not activate customer export while this proof fails.
2. **Reviewed interview schema.** Version an answer model separately from display copy. Map every applicable applicant-facing PDF item to an answer, deterministic derivation, condition, user-signature requirement, or documented reason it stays blank. Track source/part/item, requiredness, allowed values, character constraints, repeatable history and overflow handling. Do not split names or infer legal answers silently. Document the supported filing scenarios and human-review exits.
3. **Deterministic filling service.** Validate against the selected form/schema/template version; reject unknown fields and unsupported scenarios. Use stored, user-confirmed answers for export. AI may explain questions or propose structured answers, but it must not choose unchecked legal facts, bypass validation, mark certification boxes, or use arbitrary PDF field names. Enforce ownership and version checks for every draft and generated document.
4. **Review, export and print.** Show a complete answer review and outstanding/conditional items before generating. Provide the completed editable PDF by default, with a separate explicit print/static option if implemented. Cover additional-information pages and handwritten-signature instructions. Use short-lived authenticated downloads, no answer values in URLs/logs, and defined deletion/retention behavior. Test iPhone Safari, the native app's open/share path and desktop Acrobat; a mobile PDF preview alone is not proof of editable or printable output.
5. **Expand form by form.** Repeat the registry, legal/content review, mapping and document tests for each supported form. Publish an explicit capability matrix (`official-resource`, `introductory-draft`, `complete-reviewed-export`) instead of presenting all 21 as equally ready. Keep official-resource and unsupported scenarios accessible without selling an unavailable complete service.

## Required acceptance checks

- The deployed template hash and edition match the reviewed registry. An edition change blocks generation until mapping and tests are re-approved. Every page retains its edition/footer and numbering; no mixed-edition packet is assembled.
- All applicable user-facing items have a recorded mapping or an intentional disposition. Synthetic fixtures cover each supported reason, branch, optional answer, repeated entry and overflow case, including correction after saving/resuming.
- Reopen the exported document. The canonical `/AcroForm/Fields` values and effective widget values agree with confirmed answers. Checkbox/radio appearance states agree with values; updated widgets have usable appearances. A render that looks correct is insufficient if logical fields are missing or stale.
- For templates with XFA, verify that an XFA-aware reader and an AcroForm reader display the same confirmed data, or complete a reviewed compatibility strategy before release. Do not depend on `/NeedAppearances` alone. Never fill government-only, barcode or signature fields as ordinary answers.
- Render all output pages and inspect long names, international addresses, accented characters, minimum/maximum dates, multiline text, continuations and checkmarks. No clipped answers, overlapping text, damaged barcode regions, illegible shrink-to-fit text or changed official page content.
- Interactive output remains editable after download/save/reopen. If a user requests a flattened copy, verify zero remaining widgets and no AcroForm tree, then visually check every page. Preserve the editable copy separately.
- Users cannot read/export another user's draft; expired download links fail; logs contain IDs/status only; retry and cancellation do not corrupt drafts or publish partially generated files.
- Passing the short routing check never becomes a promise of eligibility, approval, filing completion or attorney review. A qualified reviewer approves the supported scenarios, instructions and business claims before those claims become public service promises.

## Production claims and policy gaps

`web/index.html` retains the user-requested guarantee headline alongside an early-preview note saying terms are unfinished. That is not an operational guarantee policy. The refund trigger, exclusions, claim procedure and responsible business need owner/legal approval before taking orders. Historical design notes also request attorney-reviewed software, current official forms, personal filing instructions, printing/shipping, samples and live support; treat each as a separate capability with evidence, not a benefit automatically delivered by adding AI.

`data/eligibility-main.json` explicitly labels results preliminary. `data/eligibility-other.json` records review-only paths for TPS/DACA and historical notices about draft-watermarked instruction downloads for some forms. Those notes are unresolved release gates for those specific documents, not verified legal guidance for a present filing. I-90/I-129F instructions downloaded for this audit did not contain a draft watermark in extracted text. The remaining 19 templates and their current accepted editions were not independently re-audited in this pass.

No user account, payment, notification delivery or backend change can by itself establish PDF completeness. This audit supports staged engineering work and does not certify a customer's eligibility or a filing packet.
