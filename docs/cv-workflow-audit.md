# Audit: Upload, chỉnh sửa, template và export CV — hướng "Original CV First"

Phạm vi: chỉ đọc mã nguồn (commit `a7b379a`). Không chạy app, không đụng DB, không gọi AI.

## Tóm tắt

- Hệ thống **đã lưu nguyên bản file gốc** (`saved_cvs.originalBytes`) và cho tải lại đúng từng byte. File gốc **không bao giờ bị sửa**.
- "Editor" **không làm việc trên PDF gốc**. Nó làm việc trên **văn bản trích xuất → profile có cấu trúc → Tailored CV draft**. Layout, font, cột, ảnh của bản gốc **bị mất hoàn toàn** khi export.
- Export (PDF/DOCX) luôn **dựng lại từ dữ liệu có cấu trúc bằng template hệ thống** (`classic` mặc định). Người dùng **không được cảnh báo** rằng layout gốc bị thay thế.
- Template chỉ là state React cục bộ, **không lưu ở đâu cả**; DOCX luôn dùng Classic.
- Vào Bước 3 (Approve & Export) **tự gọi `POST /drafts/:id/export`** để làm preview PDF, gọi lại mỗi lần đổi template. Không tốn chi phí AI, chỉ tốn CPU/DB, không ghi dữ liệu.
- Khuyến nghị MVP: **không cố "edit PDF tại chỗ"**. Thay vào đó: (1) chỉ nhận PDF cho CV, (2) hiển thị bản gốc bên cạnh, cho tải bản gốc làm lựa chọn mặc định, (3) cảnh báo rõ ràng rằng export tạo ra một **bản mới theo template**, (4) lưu template theo draft.

---

## 1. Upload CV

### Điểm vào

| Nơi                                 | File                                                                                                                                                 | Accept (frontend)   | Endpoint                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------- |
| Trang My CV                         | [MyCv.tsx:249](../apps/web/src/features/inbox/MyCv.tsx#L249)                                                                                         | `.pdf,.docx`        | `POST /api/v1/opportunities/cv`              |
| Chọn CV trong job ("Upload new CV") | [JobCvPicker.tsx:77](../apps/web/src/features/inbox/JobCvPicker.tsx#L77)                                                                             | `.pdf,.docx`        | cùng endpoint (qua `match.upload`)           |
| Analysis form (CV + JD)             | [AnalysisForm.tsx:72](../apps/web/src/features/dashboard/AnalysisForm.tsx#L72)                                                                       | `.pdf,.docx` + MIME | `POST /api/v1/analyses`                      |
| JD upload (không phải CV)           | [JobEditor.tsx:1214](../apps/web/src/features/inbox/JobEditor.tsx#L1214), [JobsPanel.tsx:132](../apps/web/src/features/dashboard/JobsPanel.tsx#L132) | `.pdf,.docx`        | `POST /opportunities/parse-document`, import |

**Không có luồng "thay thế" (replace) CV.** Upload luôn **thêm CV mới** ([opportunities.controller.ts:133](../apps/api/src/opportunities/opportunities.controller.ts#L133), tối đa 5 CV — `MAX_SAVED_CVS`). Muốn thay phải upload mới rồi xoá cũ; xoá bị chặn nếu CV là mặc định hoặc đang được job dùng (`JobMatchService.deleteCv`).

### Kiểm tra định dạng

1. **Frontend**: chỉ thuộc tính `accept` — gợi ý cho hộp chọn file, không phải validation.
2. **Multipart**: `readJobUpload` ([job-import.upload.ts:110-150](../apps/api/src/opportunities/job-import.upload.ts#L110)) gọi `validateDocumentInput` với **tên file + MIME do client khai báo**, giới hạn 5 MiB khi stream.
3. **`validateDocumentInput`** ([extraction.validation.ts:40-70](../apps/api/src/extraction/extraction.validation.ts#L40)): yêu cầu **cả** đuôi `.pdf` **và** MIME `application/pdf` (tương tự DOCX). Kiểm tra tên file (không `/ \`, không ký tự điều khiển, ≤255).
4. **Nội dung thực**:
   - PDF: `hasPdfHeader` tìm chữ ký `%PDF-` trong 1024 byte đầu ([pdf.parser.ts:35](../apps/api/src/extraction/pdf.parser.ts#L35)), sau đó pdf.js parse trong worker có deadline và giới hạn tài nguyên.
   - DOCX: `inspectDocxZip` + `validateDocxPackage` rất chặt (chặn macro/VBA/ActiveX/OLE/file thực thi, chỉ cho hyperlink ngoài http/https/mailto, chống ZIP bất thường).
5. `saveCv` ([job-match.service.ts:495](../apps/api/src/matching/job-match.service.ts#L495)) chỉ lưu khi parse ra **văn bản không rỗng** → PDF scan (ảnh) bị từ chối.

**Đánh giá bảo mật**: đủ tốt cho MVP. Giới hạn 5 MiB nhất quán (`EXTRACTION_LIMITS.fileBytes`, `UPLOAD_LIMITS.fileBytes`, stream). Parse ở worker có giới hạn. Lưu ý nhỏ:

- `mediaType` lưu vào DB là giá trị client gửi (đã bị ép bằng `application/pdf` hoặc DOCX MIME nên an toàn).
- `GET /opportunities/cv/:cvId/file` trả về bytes gốc qua `sendAttachment` (attachment, không inline) → không rủi ro XSS từ PDF.
- PDF có JavaScript/form/embedded file không bị lọc, nhưng hệ thống không render PDF gốc phía server nên chấp nhận được.

### PDF-only có thực thi nhất quán được không?

Có. Chỉ cần một điểm: thêm tham số/hàm kiểm tra riêng cho CV (ví dụ `validateCvInput` trả lỗi nếu kết quả `validateDocumentInput` khác `'pdf'`) trong `readJobUpload`/`saveCv`, và `/analyses` nếu muốn. Đổi `accept=".pdf"` ở `MyCv.tsx`, `JobCvPicker.tsx`, `AnalysisForm.tsx` (trường CV). **Không đổi** upload JD (JD DOCX vẫn hợp lệ).

**Ảnh hưởng CV DOCX đã có**: không. Các dòng đã lưu giữ nguyên `text`, `sourceMetadata`, profile, draft; CV Match và Tailored CV đọc `text`, không đọc lại file. CV cũ không có bytes gốc (`mediaType` null, `originalAvailable: false`) vẫn hoạt động như hiện tại.

**Khuyến nghị**: **Có, áp dụng PDF-only cho upload CV mới** — đơn giản hoá thông điệp "bản gốc của bạn" (PDF xem được ngay trong trình duyệt). Giữ DOCX cho JD. Cần thông báo lỗi rõ: "Chỉ hỗ trợ PDF có văn bản. Hãy xuất CV Word sang PDF."

---

## 2. CV editor

### Luồng từ chọn CV → editor

1. Job chọn CV: `PUT /opportunities/:id/cv/current` → `selectJobCv` ghi `opportunities.cvId` (mặc định dùng CV default).
2. `TailoredCvWorkflow` mount `TailoredCvReview` với `key={jobId}` và prop `cv` (`{fileName, updatedAt}`) ([TailoredCvWorkflow.tsx:483](../apps/web/src/features/inbox/TailoredCvWorkflow.tsx#L483)).
3. Readiness/draft được tải theo `cv.updatedAt` + `jobRevision` (`expectedSavedCvUpdatedAt`, [TailoredCvReview.tsx:205-250](../apps/web/src/features/inbox/TailoredCvReview.tsx#L205)).
4. Backend: `POST /tailored-cv/sources` tạo `CvSourceRevision` từ **`saved_cvs.text`** (snapshot văn bản, `originalBytesRetained: false`, [tailored-cv.service.ts:85-117](../apps/api/src/tailored-cv/tailored-cv.service.ts#L85)) → `CvProfileRevision` (các section người dùng xác nhận) → `TailoredCvDraft` theo job.

### Nguồn và bản chất editor

- Nguồn: **văn bản trích xuất** + segments + `pdfLayout` (toạ độ các đoạn chữ, tối đa 768 item / 48 KiB, [pdf-layout.ts](../apps/api/src/extraction/pdf-layout.ts)). `pdfLayout` chỉ dùng để nhận diện cấu trúc (ví dụ cột Skills), **không dùng để dựng lại hình thức**.
- Editor sửa **dữ liệu có cấu trúc** (facts/sections/rewrites), lưu thành revision của draft. **Không bao giờ sửa file gốc**; mỗi job có draft riêng.
- Font, màu, cột, ảnh, icon, bảng, header/footer của PDF gốc: **không được giữ**. pdf.js đã báo `IMAGE_CONTENT_NOT_INTERPRETED`.

### Đổi CV

- Cùng job, đổi CV: component không remount (`key={jobId}`), nhưng effect phụ thuộc `cv.updatedAt` nên readiness/draft được tải lại. **Cần kiểm thử thủ công**: hai CV có `updatedAt` trùng (hiếm) hoặc local edit chưa lưu khi đổi CV — chưa thấy test cover trường hợp này.
- Đổi job: remount theo `key` → state sạch.

### Giới hạn kỹ thuật riêng của PDF

- PDF là định dạng **đặt glyph theo toạ độ**, không có khái niệm đoạn văn/reflow. Sửa chữ dài hơn sẽ tràn, chồng chữ.
- Font thường nhúng **subset** → ký tự mới (đặc biệt tiếng Việt có dấu) có thể không có glyph.
- Thứ tự đọc nhiều cột, text dạng đường cong/ảnh, PDF từ Canva/scan không trích xuất tin cậy.
- Thư viện hiện có: `pdfjs-dist` (đọc), `pdfkit` (tạo mới), `docx`, `mammoth`. **Không có thư viện sửa PDF** (pdf-lib…). Thêm vào cũng chỉ làm được overlay/vá chữ, không phải chỉnh sửa có reflow.

---

## 3. Chọn template

- Định nghĩa: `CV_TEMPLATES = ['classic','modern','compact']` + `THEMES` ([tailored-cv-export.ts:500-573](../apps/api/src/tailored-cv/tailored-cv-export.ts#L500)); bản sao frontend ở [tailored-cv.contract.ts:353](../apps/web/src/features/inbox/tailored-cv.contract.ts#L353) (phải giữ đồng bộ tay).
- Mặc định: `'classic'` cứng ở 3 nơi (state `useState<CvTemplate>('classic')` [TailoredCvReview.tsx:184](../apps/web/src/features/inbox/TailoredCvReview.tsx#L184), `fetchDraftFile`, `TailoredCvExportService.export`).
- Lưu trữ: **không lưu** — không theo user, CV hay draft. Reload/đổi job → về Classic.
- Ảnh hưởng: preview HTML (`TailoredCvPreview`), preview PDF Bước 3, **và file PDF tải về**. **DOCX bỏ qua template** (`renderDocx` không nhận tham số; helper text ghi "DOCX keeps the Classic layout").
- Cảnh báo thay layout gốc: **không có**. UI không nhắc tới bản gốc ở bước export.

---

## 4. Export PDF/DOCX

### Pipeline

`POST /api/v1/tailored-cv/drafts/:id/export` ([tailored-cv.controller.ts:312](../apps/api/src/tailored-cv/tailored-cv.controller.ts#L312)) → `TailoredCvExportService.export` ([tailored-cv-export.ts:806](../apps/api/src/tailored-cv/tailored-cv-export.ts#L806)):

1. Validate body (`expectedRevision`, `format`, `template` tùy chọn).
2. Transaction `pessimistic_read`: đọc draft, kiểm tra revision → `canonicalExport(document, revision)` (khối text chuẩn hoá).
3. `renderPdf(snapshot, template)` (pdfkit, A4) hoặc `renderDocx(snapshot)`.
4. Đọc lại draft: revision không đổi **và** đã approve (`review.approval.revision`), nếu không → `CV_EXPORT_NOT_APPROVED`/`CONFLICT`.

- Nguồn: **dữ liệu cấu trúc của draft + template hệ thống**. Không dùng file gốc.
- File gốc: **không đổi** (export chỉ đọc).
- Nhất quán với preview: PDF Bước 3 **chính là** file export (cùng endpoint) → chính xác. Preview HTML (`TailoredCvPreview`) là xấp xỉ bằng CSS. DOCX **không có preview** và khác PDF khi chọn Modern/Compact. Có probe so sánh text DOCX/PDF ([docs/audits/p8-export-acceptance.probe.mjs](audits/p8-export-acceptance.probe.mjs)), không so sánh hình thức.

### Request khi mở tab export

Có. Effect ở [TailoredCvReview.tsx:580-601](../apps/web/src/features/inbox/TailoredCvReview.tsx#L580) tự gọi `fetchDraftFile(..., 'pdf', template)` khi `wizardStep === 3` và draft đã approve, không có local edit. Gọi lại khi: đổi template, revision mới, bấm Retry. Không cache theo key → quay lại Bước 3 sẽ gọi lại.

- **Chi phí**: không có AI, không ghi DB. Tốn 2 truy vấn + render pdfkit (CPU, vài trăm ms) mỗi lần. Đổi template liên tục → nhiều request song song (request cũ không bị abort, chỉ bị bỏ qua bằng cờ `live`).
- **Tác dụng phụ**: không có. Request này là preview hợp lệ, **không phải lãng phí**; chỉ nên thêm `AbortController` và cache blob theo `pdfKey`.

---

## 5. Thiết kế "Original CV First" đề xuất

### Phân loại

**1. Đã có**

- Lưu bytes gốc, tải lại nguyên bản (`GET /opportunities/cv/:cvId/file`, nút trong My CV).
- File gốc không bao giờ bị sửa; draft là bản tách biệt theo job, có revision và approval.
- Validate định dạng hai lớp (khai báo + nội dung), parser cô lập, giới hạn 5 MiB.
- Preview PDF Bước 3 đúng 100% với file tải về.
- 3 template PDF.

**2. Thiếu**

- Xem PDF gốc trong app (hiện chỉ có tải xuống).
- Cảnh báo "export sẽ tạo bản mới theo template, không giữ layout gốc".
- Lựa chọn "Dùng CV gốc" như đầu ra hợp lệ (ví dụ khi không có rewrite nào cần áp dụng).
- Lưu template theo draft.
- Luồng thay thế CV; PDF-only cho CV.
- Template cho DOCX; preview DOCX.

**3. Giới hạn kỹ thuật**

- Không thể chỉnh sửa PDF gốc mà giữ layout một cách tin cậy (glyph theo toạ độ, font subset, không reflow, tiếng Việt).
- Không thể dựng lại font/cột/ảnh từ dữ liệu trích xuất.
- PDF scan/ảnh không trích xuất được (đã bị từ chối khi upload).

**4. Khuyến nghị cho MVP** (theo thứ tự ưu tiên)

| #   | Thay đổi                                                                                                                                                                                                                 | File chính                                                                                                                      | Rủi ro                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **PDF-only cho upload CV** (backend + `accept`), JD giữ DOCX                                                                                                                                                             | `job-match.service.ts` `saveCv`, `readJobUpload` hoặc wrapper CV, `MyCv.tsx`, `JobCvPicker.tsx`, `AnalysisForm.tsx`, i18n vi/en | Thấp. Không ảnh hưởng dữ liệu cũ. Cần sửa test upload DOCX CV hiện có.                                                                                           |
| P2  | **Hiển thị CV gốc** ở My CV và Bước 3: `<iframe>`/`object` dùng blob từ `/cv/:id/file` (cần thêm chế độ `inline` hoặc fetch→blob như preview hiện có). Nút "Tải CV gốc" luôn có.                                         | `opportunities.controller.ts` `cvFile`, `MyCv.tsx`, `TailoredCvReview.tsx`                                                      | Thấp–TB. Khi inline cần `Content-Type: application/pdf` + `X-Content-Type-Options: nosniff` + CSP sandbox; ưu tiên fetch→blob để giữ attachment.                 |
| P3  | **Cảnh báo rõ trước khi export**: banner tại Bước 3 "File tải về được tạo lại theo template hệ thống. Font, cột, ảnh và định dạng của CV gốc không được giữ. CV gốc không thay đổi." + đặt preview gốc cạnh preview mới. | `TailoredCvReview.tsx`, i18n                                                                                                    | Thấp. Chỉ UI.                                                                                                                                                    |
| P4  | **Lưu template theo draft** (ví dụ trường trong `document.review` hoặc cột mới) để preview/tải về/reload nhất quán; DOCX ghi rõ "Classic".                                                                               | `tailored-cv-export.ts`, draft service, contract web                                                                            | TB: cần migration hoặc thay đổi JSON schema draft → verify migration đầy đủ theo AGENTS.md. Có thể hoãn bằng `localStorage` theo draft id (không cần migration). |
| P5  | Preview PDF: `AbortController` + cache blob theo `pdfKey`                                                                                                                                                                | `TailoredCvReview.tsx`, `fetchDraftFile`                                                                                        | Thấp.                                                                                                                                                            |

Không đổi: CV Match, profile, draft, approval, endpoint export (chỉ thêm, không sửa hợp đồng).

**5. Để sau**

- Luồng "Replace CV" (giữ id, cập nhật bytes + text, tạo source revision mới) — đụng tới `cvUpdatedAt` của match/draft, cần thiết kế stale state.
- Template DOCX, preview DOCX.
- "Template giống CV gốc": suy ra màu/cỡ chữ/cột từ `pdfLayout` để chọn template gần nhất.
- Vá chữ trực tiếp trên PDF (pdf-lib overlay) cho sửa nhỏ cùng độ dài — chỉ khi có nhu cầu thật, chấp nhận không hỗ trợ tiếng Việt ngoài glyph có sẵn.
- Một nguồn duy nhất cho `CV_TEMPLATES` (`packages/shared`) khi có thêm hợp đồng dùng chung.

### Test cases

Backend (Jest/integration PostgreSQL test DB):

1. Upload CV `.pdf` + `application/pdf` + `%PDF-` → 200, `originalAvailable: true`.
2. Upload CV `.docx` → 400 với thông báo PDF-only; số CV không đổi.
3. File `.pdf` nhưng nội dung là DOCX/ZIP → 400 (`HEADER_SIGNATURE_REJECTED`).
4. MIME `application/pdf` nhưng đuôi `.txt` → 400.
5. > 5 MiB → 400; PDF scan không có text → 400.
6. CV DOCX đã có trong DB: list, match, tạo draft, export vẫn chạy.
7. JD upload DOCX qua `parse-document` vẫn chạy.
8. `GET /cv/:id/file` trả đúng bytes; CV của owner khác → 404.
9. Export PDF với từng template trả PDF hợp lệ; draft chưa approve → `CV_EXPORT_NOT_APPROVED`; file gốc không đổi (so hash `originalBytes` trước/sau).

Frontend (Vitest): 10. Input file CV có `accept=".pdf"`; input JD vẫn `.pdf,.docx`. 11. Bước 3 hiển thị cảnh báo layout và nút "Tải CV gốc". 12. Đổi template → chỉ một request PDF còn sống (request cũ bị abort); quay lại Bước 3 cùng key không gọi lại. 13. Đổi CV trong cùng job → readiness/draft tải lại, không giữ state của CV cũ.

Browser smoke (Playwright, dữ liệu giả): upload PDF giả, xem bản gốc, đổi template ở Bước 3, tải PDF, kiểm tra 375px.

### Rủi ro còn lại

- Người dùng có thể vẫn kỳ vọng "sửa trên CV của tôi"; cảnh báo + xem song song giảm nhưng không loại bỏ khoảng cách này.
- Inline PDF gốc mở rộng bề mặt tấn công (PDF có JS) — dùng blob URL trong iframe sandbox, không inline từ cùng origin API.
- Hành vi đổi CV trong cùng job chưa được kiểm thử thủ công trong audit này.
