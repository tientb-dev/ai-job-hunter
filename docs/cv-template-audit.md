# Audit: CV template và export — chuẩn bị Phase 2

Phạm vi: chỉ đọc mã tại `402acd2` (sau PR #135). Không chạy app, không gọi AI.

## 1. Hiện trạng

### Template PDF

- Định nghĩa: `CV_TEMPLATES = ['classic','modern','compact']` và `THEMES` trong [tailored-cv-export.ts](../apps/api/src/tailored-cv/tailored-cv-export.ts) (~dòng 500–573). Frontend có bản sao tay ở [tailored-cv.contract.ts](../apps/web/src/features/inbox/tailored-cv.contract.ts) (`CV_TEMPLATES`).
- Cả ba dùng **cùng một bộ khối nội dung** (`canonicalExport`) và cùng thuật toán phân trang trong `renderPdf`; chỉ khác tham số:
  - **Classic**: một cột, tiêu đề trên đường kẻ mảnh.
  - **Modern**: dải màu chứa thông tin liên hệ (`band`), tiêu đề mục ở cột trái 118pt (`side`), chữ hoa.
  - **Compact**: lề hẹp, cỡ chữ nhỏ hơn, header căn giữa, tiêu đề trên nền màu (`shade`).
- Font: chỉ **DejaVu Sans** (regular/bold) nhúng sẵn trong `assets/fonts`. Hỗ trợ tiếng Việt. Ký tự không có glyph → lỗi rõ ràng `CV_EXPORT_UNSUPPORTED_TEXT` (`validateGlyphs`), không âm thầm bỏ chữ.
- Phân trang: dòng không phải đoạn văn thường không bị cắt ngang trang; tiêu đề đi kèm nội dung đầu tiên; tối đa 40 trang (`CV_DRAFT_CONTEXT_LIMIT`). Nhãn kỹ năng dài được xếp chồng (`stackedLabel`), cùng quyết định cho PDF và DOCX.

### DOCX

- `renderDocx` **không nhận template**: luôn một bố cục giống Classic (DejaVu Sans, tiêu đề có đường kẻ, cột nhãn kỹ năng bằng tab stop).
- Font **không được nhúng** vào DOCX; máy không có DejaVu Sans sẽ thay font → khoảng cách và ngắt trang khác PDF.
- Ngắt trang do Word quyết định (`keepNext`, `keepLines`, `widowControl`), không đảm bảo trùng PDF.
- Modern (cột tiêu đề bên trái, dải màu) cần bảng hoặc text box trong DOCX → phức tạp, dễ vỡ khi người dùng sửa trong Word.

### Chọn template và lưu lại

- Chỉ là state React `useState<CvTemplate>('classic')` trong [TailoredCvReview.tsx](../apps/web/src/features/inbox/TailoredCvReview.tsx). **Không lưu**: tải lại trang, đổi job hoặc mở draft khác đều quay về Classic.
- API `POST /tailored-cv/drafts/:id/export` nhận `template` (tùy chọn, mặc định `classic`), chỉ áp dụng cho PDF.
- Lưu template vào `document.review` sẽ **tăng revision và làm mất approval** (approval gắn với `revision`) → không nên lưu ở đó.

### Preview và export

- Bước 3 (đã duyệt, không có thay đổi chưa lưu): preview là **chính file PDF export** → khớp 100%.
- Trước khi duyệt và màn không-wizard: `TailoredCvPreview` là HTML/CSS **xấp xỉ** `THEMES` (`templateSx`, có comment "Approximates"). Cỡ chữ, ngắt dòng, ngắt trang có thể khác PDF.
- Không có preview DOCX.
- Đổi template ở Bước 3 → gọi lại export (render pdfkit, không AI, không ghi DB); request cũ không bị hủy (đã ghi nhận ở audit Phase 1, chưa làm).

### Test hiện có

- [cv-export.spec.ts](../apps/api/test/unit/cv-export.spec.ts): DOCX/PDF cùng nội dung chữ, Unicode, hình học trang, glyph thiếu, giới hạn, nhãn kỹ năng, link hồ sơ, không có ký tự tab ở mọi template.
- [cv-templates.spec.ts](../apps/api/test/unit/cv-templates.spec.ts): mỗi template giữ mọi chữ trong trang (theo từng fixture); các template cho ra PDF khác nhau.
- Web: `tailored-cv-review`, `tailored-cv-wizard`, `tailored-cv-preview` (ô chọn template, khung thông báo vi/en).
- Integration `tailored-draft.spec.ts`: export cần approval, header và MIME đúng.

### Ràng buộc tương thích

- Client cũ không gửi `template` vẫn phải nhận Classic.
- Draft cũ không có template đã lưu → mặc định Classic.
- Không đổi revision/approval khi đổi template.
- Tên file export `tailored-cv-<id>-r<rev>.<ext>` đang được test.

## 2. Rủi ro

| Rủi ro                                                | Mức        | Ghi chú                                                                |
| ----------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| HTML preview khác PDF thật (trước khi duyệt)          | Trung bình | Người dùng chọn template dựa trên bản xấp xỉ                           |
| DOCX luôn Classic, font không nhúng                   | Trung bình | Phải nói rõ; không nên giả vờ DOCX có Modern                           |
| Modern: cột tiêu đề 118pt với tiêu đề dài, tiếng Việt | Thấp–TB    | Đã có test "text inside page", nên thêm fixture tiêu đề tiếng Việt dài |
| Compact chữ nhỏ (8.5–9.5pt) khó đọc khi in            | Thấp       | Ghi chú trong mô tả                                                    |
| Template không lưu → tải về khác lựa chọn trước đó    | Trung bình | Mục tiêu chính của Phase 2                                             |
| Thay đổi `THEMES` mà quên `templateSx`                | Thấp       | Hai bản sao tay; test tồn tại cho từng phía                            |

## 3. Kế hoạch tối thiểu đề xuất

Thứ tự ưu tiên; mỗi bước là một PR nhỏ.

### P1 — Lưu template theo draft (cần migration)

- Migration đảo ngược được: `tailored_cv_drafts."exportTemplate" text NULL CHECK ("exportTemplate" IN ('classic','modern','compact'))`. `NULL` = Classic. Không backfill.
- Endpoint mới `PUT /api/v1/tailored-cv/drafts/:id/template` `{ template }`: chỉ cập nhật cột này, **không đổi `revision`, `updatedAt` của review, hay approval**. Kiểm tra owner như các endpoint draft khác.
- DTO draft trả về `exportTemplate`. Web khởi tạo state từ giá trị này; đổi template → gọi endpoint (lạc quan, lỗi thì báo qua `useNotify` và giữ giá trị cũ).
- Export: nếu body không có `template` thì dùng giá trị đã lưu (client cũ vẫn chạy).
- Kiểm tra migration: apply/revert/reapply ở TS và JS đã biên dịch.

### P2 — Lựa chọn template dễ hiểu

- Giữ ba template; **Classic, Modern** là chính, **Compact** ghi "tùy chọn – nhiều nội dung trên ít trang hơn".
- Đổi `TextField select` thành nhóm lựa chọn (radio card) gồm tên, một câu mô tả, và hình thu nhỏ dựng bằng chính `TailoredCvPreview` thu nhỏ (không thêm ảnh tĩnh).
- Ghi rõ dưới nhóm: "Chỉ áp dụng cho PDF. DOCX luôn dùng bố cục Cổ điển để dễ chỉnh sửa trong Word."
- Khung thông báo Phase 1 giữ nguyên.
- Backlog (phát hiện khi smoke test P1): ở 375px, tên template dài bị cắt bằng dấu "…" trong ô chọn (ví dụ "Gọn — đầu trang căn giữa, nhiều nộ…"). Xử lý khi làm thẻ chọn template, không sửa trong P1.

### P3 — Hành vi PDF/DOCX nhất quán và được ghi rõ

- **Không** làm DOCX Modern/Compact ở bước này. Ghi trong `docs/architecture.md`: PDF = bản trình bày theo template; DOCX = bản Classic có thể chỉnh sửa, font có thể bị thay.
- Nhãn trên nút: "Tải xuống DOCX (Cổ điển, chỉnh sửa được)".
- Tùy chọn sau: nhúng font vào DOCX (Word hỗ trợ embedded TrueType) nếu người dùng phản ánh lệch font.

### Để sau

- Hủy request preview cũ và cache blob (P5 audit Phase 1).
- DOCX theo template.
- Một nguồn chung cho `CV_TEMPLATES`/`THEMES` giữa web và API.
- Preview PDF thật trước khi duyệt (cần export không yêu cầu approval → thay đổi policy, không làm lúc này).

## 4. Test đề xuất

API (Jest + PostgreSQL test DB):

1. Migration apply/revert/reapply, TS và JS biên dịch; draft cũ đọc ra `exportTemplate = null`.
2. `PUT .../template` hợp lệ lưu giá trị, **revision và approval không đổi**; giá trị lạ → 400; draft của owner khác → 404.
3. Export không có `template` dùng giá trị đã lưu; có `template` thì dùng giá trị gửi lên; DOCX luôn Classic.
4. `cv-templates.spec`: thêm fixture tiêu đề và nhãn tiếng Việt dài cho Modern.

Web (Vitest): 5. Mở draft có `exportTemplate: 'modern'` → lựa chọn hiển thị Modern, khung thông báo ghi "Mẫu PDF: Hiện đại". 6. Đổi template gọi endpoint một lần; lỗi → popup lỗi, lựa chọn quay về giá trị cũ. 7. Đổi template không làm mất trạng thái "đã duyệt". 8. Nhóm lựa chọn dùng được bằng bàn phím, đọc được ở 375px, vi/en.

Browser smoke: dữ liệu giả, đổi template, tải lại trang vẫn giữ lựa chọn, tải PDF, 375px.
