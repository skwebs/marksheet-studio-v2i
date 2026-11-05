# Implementation changelog

## Generic first-run identity and workspace safety
- Replaced school-specific first-run defaults with neutral demo school details.
- Preserved all school profile, logo, watermark, signature and template customization capabilities.
- Updated both supplied marksheet templates to neutral demo text and a generic demo logo.
- Added workspace validation to block blank class/session saves and workspace renames.
- Added a saved-workspace deletion control with confirmation and active-workspace protection.
- Integrated supplied product artwork into app icons, favicon, PWA manifest and Open Graph/Twitter preview metadata.
- Bumped the service-worker cache version and added new branding assets to the application shell.

## Build export and production URL metadata
- Exported `createDefaultData` from `src/data.ts`, fixing the import in the active application entry point `src/main.tsx`.
- Added `https://ms-gen.isatish.in/` as the canonical URL and Open Graph URL in `index.html`.

- Removed obsolete source copies `src/main.tsx.txt` and `src/old-main.tsx`, plus unreferenced `public/favicon.png`; active favicon assets remain under `public/icons/` and `public/favicon.ico`.


## Header logo rendering correction
- Fixed the modern marksheet renderer selector to recognize the current template header image alt labels (`Demo school logo` and `Education illustration`).
- This restores dynamic substitution from the configured left/right school logo settings instead of leaving the template placeholder artwork in place.
- No school-image settings, data fields, template layout, or marksheet features were removed or changed.


## School identity rendering audit and correction
- Compared the current project against the original supplied source archive (`marksheet-studio-v2-implemented.zip`).
- Found that the modern template renderer queried `.school-name` and `.school-address`, but both shipped templates lacked those classes; as a result, the school name and address remained hardcoded demo text.
- Added stable `schoolLogoLeft` and `schoolLogoRight` IDs and the expected school name/address selectors to both marksheet templates.
- Updated rendering to use stable logo IDs, preserving independent left/right logo settings, visibility toggles, and the existing shared-left-logo option.
- Removed fixed school identity and logo URLs from template fallbacks; runtime data now supplies school identity, logos, metadata, watermark, and document title.
- Restored the original `public/nps-logo.webp` asset for compatibility with existing template/backup references; it is no longer forced as the rendered school logo.
- Restored the original default exam label (`HALF-YEAR EXAMINATION`) rather than using a demo exam label.
- Kept neutral demo school values only as first-run defaults in `createDefaultData`; saved school settings are not modified.

## Developer profile attribution (2026-11-03)
- Added an About section with the confirmed Creator & Developer profile for Satish Kumar Sharma.
- Added initials-only SKS avatar; education details are intentionally omitted.
- Added website, GitHub and public email links supplied by the user.
- Added a subtle developer attribution to the existing footer without replacing local-first or workspace statistics.
- Added a startup splash overlay with developer attribution while existing local data and marksheet templates are loaded. It dismisses when the existing bootstrap promise settles and does not alter persistence or marksheet generation.
- No school identity, marksheet template, result calculation, import/export, backup, restore, promotion, or workspace data logic was intentionally changed.


## Workspace delete-selector label fix
- Fixed JSX interpolation in the saved-workspace deletion selector in `src/main.tsx`.
- Academic session and student count now render as values rather than literal `${...}` text.
- No workspace data, deletion behavior, or other UI logic changed.

## PWA custom loading splash refinement (2026-11-03)
- Updated the custom React splash title to `Marksheet Studio V2` and clarified the product subtitle.
- Kept the existing application icon visible during bootstrap and added a small animated loading indicator.
- Preserved the existing bootstrap lifecycle: the splash is removed when the current initialization promise settles, including its existing error path. No artificial delay or minimum display duration was introduced.
- Bumped the service-worker shell cache version so installed clients can transition away from the previous cached shell after deployment.
- Added `*.zip` to `.gitignore`; retained all existing ignore rules, including `dist/`.
\n\n## Student table density and marks-entry keyboard navigation (2026-11-03)\n- Changed the student-row transfer and delete controls to a single horizontal action group with a wider action column, preventing the two icons from stacking and increasing row height.\n- Added spreadsheet-style vertical navigation to marks-entry cells: Enter/Arrow Down moves to the next student in the same subject; Shift+Enter/Arrow Up moves to the previous student.\n- Preserved native Tab and Shift+Tab navigation across subjects, and left arrow-left/right behavior untouched.\n- Kept navigation within the current marks grid; it does not jump to another subject or create students at the end.\n- No student data, transfer/delete logic, mark calculations, imports, templates, or other form keyboard behavior was changed.\n
## High-resolution marksheet downloads (2026-11-03)
- Added PNG, JPEG and PDF download workflows based on the existing `renderMarksheet()` output and the supplied `.sheet` element; no separate marksheet layout was introduced.
- Added A4 portrait export with 300-DPI capture scaling, preserving the template's existing 210 mm × 296 mm sheet proportions on an A4 page.
- Added all-student, selected-student and current-student scopes.
- Added combined multi-page PDF and individual PDF files packaged in ZIP; multiple PNG/JPEG files are packaged in ZIP, while a single image downloads directly.
- Added per-student capture progress and cancellation checks.
- Existing preview, print, backup/restore, marks calculations and source HTML templates remain unchanged.
- Exported PDF content is raster-based to prioritize visual fidelity; text is not selectable. The current template page is portrait; no landscape template was present in the inspected source.

## 2026-11-03 — Workspace manager, attendance import and responsive sidebar

- Added a dedicated Workspace Manager with create/open/search/archive/restore/delete workflows using the existing IndexedDB workspace snapshots.
- New workspaces inherit the active workspace's school, exam, grading and marksheet configuration, while student records, result rows and attendance start empty.
- Added archived workspace metadata in IndexedDB schema version 3; archived data is retained and must be restored before it can be opened or edited.
- Serialized app persistence and hardened workspace switching, class renaming, student moves and workspace creation against pending or in-flight saves writing stale workspace state.
- Simplified the attendance CSV template to `Session, Class, Roll, Name, Present day`; only Roll and Present day are required.
- Attendance import now takes working days from the attendance header, validates optional identity columns when supplied, reports row errors, supports importing valid rows after review, and asks before replacing or skipping existing attendance records.
- Added explicit attendance-record tracking for newly edited/imported attendance while retaining compatibility with existing student records.
- Added desktop sidebar expanded/collapsed/hidden modes, a fixed sidebar header/footer with independently scrollable navigation, and a mobile slide-in drawer with backdrop, Escape handling and body-scroll locking.

## 2026-11-03 — Desktop hidden-sidebar layout and circular QR centre logo

- Corrected desktop/tablet application-shell grid sizing so the hidden sidebar cannot leave an empty grid track; the main content now explicitly spans the available width.
- Added defensive `min-width: 0` sizing to desktop main-content children and allowed the Students panel heading/actions to wrap without constraining the panel width.
- Updated QR centre-image rendering to crop the selected school/separate QR image into a circle with a white circular surround and ring.
- Kept QR payload, QR error-correction level, marksheet fields, and marksheet templates unchanged.

## Configurable non-numeric marks and absence handling

- Added workspace-level non-numeric marks status configuration with code, meaning, marksheet display value, calculation rule (`exclude` or `count-as-zero`) and active state.
- Added default `Ab` / Absent status. Additional codes can be configured by the school.
- Manual marks entry dynamically uses a numeric input for numeric/empty values and switches to text input when a non-numeric value is entered. Configured values are normalized to their display value; unknown text is retained during editing and flagged.
- Excel/CSV result imports accept configured active non-numeric codes and reject unknown text values with row/subject diagnostics.
- Added an exam-wide absence action that marks every enabled subject `Ab`; it asks for confirmation before replacing existing subject values. Subject-wise absence remains available by entering the configured code in an individual subject cell.
- Marksheet tables display configured status labels. Calculation rules determine whether a status is excluded or counted as zero.
- Preview, print-all and download generation skip students who have no numeric marks in any selected report examination. Bulk output reports the number of skipped students before continuing.
- Existing historical status values remain recognizable after a status is deactivated or removed only from new-entry acceptance; deactivated codes are not accepted in new imports or manual entry.

## Configurable non-numeric marks — integration corrections (2026-11-04)
- Added a configurable shortcut symbol for each non-numeric marks status and an explicit setting to identify the status used for exam-wide absence.
- Status lookup accepts configured shortcut symbols, status codes and display values; persisted marks and imported marks normalize to the configured status code.
- Changed the existing marks input to text with decimal input mode so numeric entry remains optimized for mobile while configured symbols can also be entered.
- Removed the additional exam-status column from the marks grid to preserve the existing compact grid and Tab navigation. Exam-wide absence is applied from the marks panel header by student roll number.
- Fixed the typed subject-update object in the exam-wide absence operation to avoid `undefined` values in `AppData`.
- Prevented deleting a status that is already referenced by saved marks; it can be deactivated instead.


## Selective feature merge — 2026-11-05

Merged non-conflicting features from `Marksheet-Studio-V2-Multi-Sheet-Header-Row-Import` into the `ms-gen-new-s8n` base:

- Added Excel worksheet selection for student, examination marks and attendance imports.
- Added a manual column mapper with header-row selection when automatic header detection fails; existing import validation and conflict handling remain authoritative.
- Added standalone HTML marksheet export for the selected student and all eligible students as a ZIP.
- Added independent QR exam label and configurable QR frame size.
- Added per-signature vertical image offset; the signature footer, divider and designation remain in place.
- Updated QR payload to a compact summary and made chart tracks distinguish missing numeric marks from zero marks.
- Preserved the base workspace manager, archive/restore, attendance `hasRecord`, non-numeric mark statuses, and existing PNG/JPEG/PDF export implementation.

Build verification was not completed in this environment because dependencies could not be installed before the package-install timeout. TypeScript syntax transpilation was checked for edited TS/TSX files.

## Signature position slider parity
- Replaced the per-signature numeric vertical-offset input with the reference slider interaction.
- Slider range is -20 mm to +20 mm in 1 mm increments.
- Each signature block updates its own `offsetMm` value independently.
- Added per-block Reset position action (sets only that block to 0 mm).
- Retained the existing renderer and data model so the offset continues to affect only the signature image.


## Unified examination visibility and calculation selection
- Removed the independent marksheet-total examination selector.
- Header-visible examinations now define the exact calculation set.
- Selecting/deselecting an exam updates both persisted selection fields together.
- Legacy workspace normalization derives `calculationExams` from `reportExams`.
- Calculation validation and marksheet rendering use the visible examination set.
- Hidden exam marks remain stored and available to promotion workflows.


## Signature slider controls merge
- Added per-signature width, height, and vertical-position range controls with minus/plus indicators.
- Position values use the requested direction: negative moves the signature image down; positive moves it up.
- Reset position affects only the selected signature.
- Kept the unified exam-selection implementation from the working base.


## 2026-11-05 — Signature footer and sidebar alignment
- Kept the signature footer in a single non-wrapping row so long remarks do not cause signature blocks to wrap into a second row.
- Kept vertical positioning applied to the signature image only; names, dividers, designation labels and the footer row remain in normal document flow.
- Preserved the selected-signature Reset position handler, which resets only that signature's `offsetMm` to zero.
- Placed Academic Session and Class controls in one horizontal row, retaining Section as a separate optional field when enabled.

## 2026-11-05 — Fixed signature footer and configurable report header
- Added a persisted report-header layout setting: `two-rows` (default, preserving existing workspaces) or `single-row` (title and session side by side, centered as a group).
- Added a configurable 0–20 mm horizontal gap for single-row mode.
- Applied the header layout in both legacy and modern marksheet render paths.
- Anchored signature rows to the marksheet sheet bottom with a 5 mm bottom offset and reserved 30 mm of content space so remarks do not move the footer.
- Existing per-signature image offsets remain independent of names, dividers and designation labels.

## 2026-11-05 — Safe school-banner HTML and floating preview action

- Replaced the third school-banner line input with a multiline editor that accepts safe inline HTML formatting.
- Added allowlist sanitization in the marksheet renderer. Supported tags: `b`, `strong`, `i`, `em`, `u`, `span`, `small`, `sub`, `sup`, and `br`; only a restricted set of inline style properties is retained. Scriptable and unsafe elements/attributes are removed.
- Added persisted `showFloatingPreview` and `floatingPreviewPosition` settings, defaulting to visible at the right-bottom.
- Added a fixed application-level Preview marksheet button that invokes the existing preview flow and is excluded from marksheet templates/print output.
- Added responsive positioning and styling.
- Full typecheck/build could not be completed because dependencies were unavailable in the execution environment.

## 2026-11-05 — Canvas-based student photo crop UI

- Replaced the CropperJS visual crop interface with a canvas viewport that displays only the final 20:23 crop area; the surrounding source-image area is not shown.
- Preserved the existing student-photo crop callback and JPEG data-URL storage format.
- Preserved the 400 × 460 px base output and added 1×, 1.5×, 2×, 2.5×, 3× and 4× output resolutions.
- Added mouse/touch/pen dragging, two-pointer pinch zoom, mouse-wheel zoom, keyboard pan/zoom/rotation, 90-degree rotation buttons, fine rotation from -45 to +45 degrees, and reset.
- Retained image replacement, use-original, cancel, and apply actions.
- Reworked cropper-specific CSS for a responsive mobile dialog and touch-safe canvas viewport.
- Removed the CropperJS runtime import; package manifest remains unchanged to avoid unnecessary lockfile churn.

## 2026-11-05 — Crop dialog layout and saved resolution setting

- Removed output-resolution selection from the crop dialog; the crop UI now contains only crop, zoom and rotation controls.
- Added a persistent workspace setting under Settings → Student photo crop settings for 1×, 1.5×, 2×, 3× and 4× output resolution.
- New crops use the configured output resolution while preserving the 20:23 crop ratio and existing JPEG data URL format.
- Made the crop dialog viewport-fitted with hidden overflow so the crop UI does not scroll on mobile or desktop.
- Fixed the initial blank crop canvas: drawing now checks the loaded image itself instead of relying on a stale React state closure captured by the image-load callback.
- Existing saved photos and settings are retained; older workspace data defaults to 1×.

## Cropper control layout refinement
- Increased the desktop crop viewport width slightly (up to 340px) while retaining the responsive portrait frame on mobile.
- Reorganized crop controls into a full-width zoom row and a second row with 90-degree left rotation, fine-rotation slider, and 90-degree right rotation.
- Kept the modal non-scrollable and preserved the existing crop, zoom, drag, pinch, and rotation behavior.

## Cropper layout refinement — 2026-11-05
- Increased the crop canvas display width slightly (up to 350px on wider screens).
- Tightened the rotation control row so the 90-degree buttons fill their side columns and remain aligned with the fine-rotation slider.
- Explicitly made the fine-rotation range input fill the centre column.
- Kept the zoom slider as a separate full-width first row and retained the existing mobile three-column rotation row.

## Cropper control spacing refinement
- Slightly reduced the visible crop canvas dimensions.
- Removed visible text from the 90-degree rotation buttons; retained accessible labels and tooltips.
- Narrowed both rotation buttons so the fine-rotation slider receives more horizontal space.


## QR size slider and configurable weak-subject remark breakpoints
- Added a synchronized 25–50 mm QR-size range slider while retaining the numeric input.
- Replaced the single weak-subject threshold/remark editor with add/remove breakpoint rules.
- Weak-subject remark selection now uses the highest threshold strictly above the subject percentage.
- Added backward-compatible normalization from the previous single-threshold settings to one breakpoint.


## Mobile sidebar scrolling and fixed brand header
- Moved the academic session controls, active workspace selector, create-workspace action, and navigation into a single vertically scrollable sidebar content region.
- Kept the Marksheet Studio brand header fixed at the top and the local-save status fixed at the bottom.
- Applied the scroll-container behavior to desktop and mobile sidebar layouts without changing workspace or settings persistence.
