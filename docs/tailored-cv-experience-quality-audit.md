# Audit: thiếu gợi ý Experience trong Tailored CV

Phase A — chỉ điều tra. Không gọi AI mới; dùng truy vết mã, metadata đã lưu của draft gần nhất (chỉ số đếm và cờ, không đọc nội dung CV) và phát lại offline 7 kết quả AI có đầu ra thô từ benchmark trước (dữ liệu giả). Không thay đổi mã ứng dụng; chỉ thêm chế độ chẩn đoán vào script đánh giá thủ công.

## 1. Luồng dữ liệu (đã truy vết)

1. `TailoredDraftService.generate` ([tailored-draft.service.ts](../apps/api/src/tailored-cv/tailored-draft.service.ts)) dựng `DraftInput`: profile CV đã rà soát (`reviewedPlan`), CV Match đã lưu, snapshot JD.
2. `reviewedPlan` ([tailored-draft.policy.ts](../apps/api/src/tailored-cv/tailored-draft.policy.ts)): mọi fact `summary`, `skill`, `description`, `text`, `source_passage` là ứng viên; tối đa 96 fact.
3. `TailoredDraftGenerator.generate` / `buildPrompt` ([tailored-draft.generator.ts](../apps/api/src/tailored-cv/tailored-draft.generator.ts)): **một** lời gọi chứa tất cả ứng viên theo thứ tự CV, khối JD (title, seniority, domain, experience, skills, preferred, mô tả cắt 3.000 ký tự), yêu cầu CV Match. Schema: `proposals` tối đa `MAX_PROPOSALS = 5` (chung cho mọi phần), `questions` tối đa 4.
4. `validateOpportunities`: kiểm tra id/entry/requirement hợp lệ.
5. `assembleDraft`: với mỗi đề xuất — ẩn nếu giống bản gốc, nếu `weakened` (bỏ lãnh đạo/sở hữu/chức danh/số liệu) hoặc `lowValue` (đảo Skills không tăng liên quan, đổi ≤2+2 từ không thêm gì liên quan JD); còn lại hiển thị, gắn `requiresConfirmation` khi có claim chưa căn cứ.
6. Chỉ lưu vào `generationMetadata.decisions` các **số đếm** (`suggestionsReturned`, `suggestionsDisplayed`, `formattingOnlySuppressed`…) và `outputHash`. **Không lưu đầu ra thô hay lý do bị ẩn** → không thể biết, từ dữ liệu đã lưu, phần nào bị ẩn và vì sao.

## 2. Bằng chứng

### 2.1 Draft gần nhất (job "Lập trình viên Java từ 3 năm kinh nghiệm", dev DB, chỉ đọc số liệu)

- API dev chạy bản build lúc 18:37, sau thay đổi cuối của bộ lọc (18:24) → draft dùng mã mới nhất.
- CV có **19 fact Experience**, 7 fact Skills, 1 Summary có thể viết lại; cả 27 đều được gửi cho AI (`assessed: 27`).
- JD: mô tả 2.485 ký tự (< 3.000, **không bị cắt**); phần yêu cầu bắt đầu ở ký tự 415.

| Draft               | AI trả | Hiển thị                                   | Bị ẩn | Câu hỏi | Token in/out |
| ------------------- | ------ | ------------------------------------------ | ----- | ------- | ------------ |
| 18:41 (lần bạn xem) | 5      | 3 (Summary — **có cờ xác nhận**; 2 Skills) | 2     | 2       | 7.098 / 807  |
| 18:37               | 5      | 1                                          | 4     | 0       | 6.809 / 696  |

- Lý do hiển thị dài 160–202 ký tự (~25–35 từ).
- Không xác định được 2 đề xuất bị ẩn thuộc phần nào (không lưu đầu ra thô). Vì Summary chỉ có 1 fact và cả 2 Skills đều hiển thị, nhiều khả năng các đề xuất bị ẩn là Experience hoặc Skills khác — **chưa chứng minh được**.

### 2.2 Phát lại offline 7 lần chạy có đầu ra thô (dữ liệu giả, 0 lời gọi AI)

`pnpm --filter @ai-job-hunter/api test:compile` rồi `node .test-dist/test/manual/tailored-cv.eval.js --dataset <bộ> --replay <tệp.json>`:

| Phần           | Ứng viên | Hiển thị | Cần xác nhận | Bị ẩn  | Lý do ẩn                                |
| -------------- | -------- | -------- | ------------ | ------ | --------------------------------------- |
| Summary        | 7        | 4        | 2            | 1      | 1 giống hệt bản gốc                     |
| Skills         | 7        | 5        | 0            | 2      | giống hệt / đảo không có ích            |
| **Experience** | **15**   | **2**    | **2**        | **11** | **6 giống hệt bản gốc, 5 giá trị thấp** |

Ví dụ Experience bị ẩn (tất cả đều thực sự không đáng xem):

| Gốc                                                                                   | AI đề xuất                                     | Lý do ẩn     |
| ------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------ |
| Led the development of core billing features **using** Java Spring Boot, MyBatis…     | …**with** Java, Spring Boot, MyBatis…          | giá trị thấp |
| Designed the REST API layer **used by** the warehouse and accounting modules.         | …**for** the warehouse and accounting modules. | giá trị thấp |
| Moved the order database from MySQL to PostgreSQL **with** a colleague.               | …**together with** a colleague.                | giá trị thấp |
| Led a team of 5 developers, running sprint planning and code reviews.                 | (y hệt)                                        | giống hệt    |
| Reduced p95 latency … from 800 ms to 200 ms …                                         | (y hệt)                                        | giống hệt    |
| Built policy management REST APIs with Java, Spring Boot and Hibernate on PostgreSQL. | (y hệt)                                        | giống hệt    |

Experience hiển thị: "Worked on many different things in the billing team…" → "Worked on billing APIs and databases, including deployments." (có ích); "Worked on backend tasks." → "…in Java." (yếu). Cần xác nhận: hai dòng thêm chi tiết mượn từ dòng khác.

**Tỷ lệ lọc nhầm (false positive): 0/11** — không có đề xuất Experience bị ẩn nào là cải thiện thực chất.

## 3. Nguyên nhân gốc

Kết luận: **mô hình có tạo ứng viên Experience, nhưng chất lượng yếu; bộ lọc ẩn đúng.** Thiếu Experience là kết hợp của:

1. **Mô hình tạo đề xuất Experience gần như không đổi** (6/15 y hệt, 5/15 đổi 1–2 từ). Prompt hiện tại (`buildPrompt`) có rất nhiều ràng buộc an toàn ("preserve…, prefer the original when it already works, never import…") và câu "Keep or strengthen verified verbs" nhưng **không có quy trình chọn và cách viết lại Experience cụ thể** (không ví dụ chuyển đổi tốt, không yêu cầu bỏ qua thay vì trả lại câu cũ). Kết quả: mô hình "an toàn" bằng cách trả lại gần như nguyên văn.
2. **Ngân sách 5 đề xuất bị chia cho Summary và Skills trước.** Prompt mô tả Summary → Skills → Experience theo thứ tự; CV thật có 7 fact Skills (mỗi nhóm kỹ năng là một fact), nên Skills dễ chiếm 2–3 chỗ (draft thật: 2 Skills hiển thị). Không có giới hạn riêng cho Skills.
3. **Không có cách biểu diễn giá trị lớn nhất của Experience cho một JD**: đưa gạch đầu dòng liên quan Java lên trước, làm nổi vai trò/dự án Java, rút gọn dự án ít liên quan (NestJS/Laravel). Schema chỉ cho "viết lại một fact"; `priorityFactIds` có trong `assembleDraft` nhưng **không được preview/export dùng**. Với CV đã viết tốt (như CV thật), cải thiện bằng câu chữ có ít dư địa; giá trị nằm ở sắp xếp/nhấn mạnh.
4. **Không có dữ liệu chẩn đoán**: không lưu ứng viên bị ẩn và lý do → không đo được trên CV thật.
5. **Summary**: lỗi "6+ years … enterprise Java backend applications" **đã được phát hiện và gắn cờ xác nhận** trong draft thật, nhưng vẫn được sinh ra — prompt chưa đưa mẫu viết đúng (tổng kinh nghiệm tách khỏi chuyên môn Java).
6. **Skills**: "RabbitMQ" lên trước "Asynchronous Messaging" được hiển thị vì `lowValue` chấp nhận mọi đảo làm giảm ≥1 cặp lệch — ngưỡng quá thấp.
7. **Lý do**: prompt cho phép "khoảng 30 từ, hai câu"; thực tế 22–37 từ; chưa đạt mục tiêu 15–25 từ.

Đã loại trừ: cắt JD (không bị cắt), giới hạn token đầu ra (807 < giới hạn, không có lỗi output limit), kiểm tra grounding lọc nhầm (0 trường hợp).

## 4. Đề xuất cải thiện (xếp theo tác động / rủi ro)

| #   | Thay đổi                                                                                                                                                                                                                                                                     | Tác động                    | Rủi ro                                              | Phạm vi                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| 1   | **Prompt Experience-first**: quy trình 2 bước (chọn 3–5 gạch đầu dòng Experience liên quan JD nhất, rồi chỉ viết lại khi có lợi ích rõ); ví dụ chuyển đổi tốt/xấu ngắn; cấm trả lại câu không đổi (bỏ qua thay vì trả lại); Experience đặt trước Summary/Skills trong prompt | Cao                         | Thấp                                                | `tailored-draft.generator.ts`                          |
| 2   | **Phân bổ ngân sách**: tối đa 1 Summary, tối đa 2 Skills; phần còn lại ưu tiên Experience (vẫn tối đa 5, không bắt buộc đủ) — prompt + cắt cứng trong `assembleDraft` theo thứ tự mô hình                                                                                    | Cao                         | Thấp                                                | generator + policy                                     |
| 3   | **Lưu chẩn đoán không chứa văn bản** vào `generationMetadata.decisions`: theo phần — số ứng viên/hiển thị/cần xác nhận/bị ẩn và mã lý do (`identical`, `weakened:leadership`, `low_value`…)                                                                                  | Cao (đo được trên CV thật)  | Thấp (JSON, không migration, không nội dung CV)     | policy + service                                       |
| 4   | **Summary**: thêm mẫu đúng vào prompt ("6+ years building business applications; Java/Spring Boot backend at <công ty> since <năm>"); giữ cờ xác nhận hiện có                                                                                                                | Trung bình                  | Thấp                                                | generator                                              |
| 5   | **Skills**: chỉ hiển thị khi giảm ≥2 cặp lệch hoặc đưa một kỹ năng JD bắt buộc vào 3 vị trí đầu; đảo trong cùng nhóm liên quan (RabbitMQ/Asynchronous Messaging) bị ẩn                                                                                                       | Trung bình                  | Thấp                                                | `lowValue`                                             |
| 6   | **Lý do ngắn**: prompt "một câu, 15–25 từ (tiếng Việt) / 12–20 từ (tiếng Anh)"; đo trong chẩn đoán; không cắt tự động                                                                                                                                                        | Trung bình                  | Thấp                                                | generator                                              |
| 7   | **Ưu tiên gạch đầu dòng theo JD** (dùng `priorityFactIds` cho thứ tự trong preview/export, người dùng chấp nhận/từ chối)                                                                                                                                                     | Cao nhất cho CV đã viết tốt | Cao: đổi schema/hợp đồng đề xuất, preview, PDF/DOCX | **Cần phê duyệt riêng; ngoài phạm vi Phase B đề xuất** |

Giữ nguyên: Chấp nhận / Xác nhận và chấp nhận / Sửa / Giữ bản gốc, kiểm tra backend, revision và duyệt, export.

## 5. Kế hoạch benchmark

Bộ dữ liệu giả (trong `apps/api/test/manual/tailored-cv.eval.ts`):

| Bộ           | Mô tả                                                                                                                                                                                                                                                            | Trạng thái |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| java-backend | JD "Lập trình viên Java từ 3 năm" (bản diễn đạt lại tổng quát từ tin TopCV công khai, không sao chép nguyên văn) + CV dạng CV thật đã ẩn danh (Technical Lead, Java/Spring Boot/MyBatis/SQL Server, microservices, RabbitMQ, GitLab CI/CD, dự án NestJS/Laravel) | mới        |
| techlead     | Senior Java / Technical Lead                                                                                                                                                                                                                                     | có sẵn     |
| fullstack    | JD Full-Stack (React + Node/Java)                                                                                                                                                                                                                                | mới        |
| ordered      | CV đã khớp JD                                                                                                                                                                                                                                                    | có sẵn     |
| thin         | CV thiếu bằng chứng                                                                                                                                                                                                                                              | có sẵn     |

Chỉ số (từ chế độ chẩn đoán + chấm tay): số gợi ý Experience có ý nghĩa, liên quan JD, chính xác, giữ trách nhiệm/thành tích, tỷ lệ gợi ý tầm thường, tỷ lệ lọc nhầm, số từ lý do, độ trễ, token.

Ngân sách AI ước tính: baseline 5 bộ × 2 = 10; sau thay đổi 5 × 2 = 10; dự phòng tinh chỉnh ≤ 6 → **≤ 26 request** (~2.000 token vào / ~550 ra mỗi request với dữ liệu giả). Dừng nếu ≥3 lỗi liên tiếp hoặc token vượt 2 lần ước tính.

## 6. Tệp dự kiến thay đổi (Phase B)

- `apps/api/src/tailored-cv/tailored-draft.generator.ts` (prompt, thứ tự, lý do).
- `apps/api/src/tailored-cv/tailored-draft.policy.ts` (ngân sách theo phần, ngưỡng Skills, mã lý do ẩn).
- `apps/api/src/tailored-cv/tailored-draft.service.ts` hoặc generator (ghi chẩn đoán vào metadata).
- Test: `tailored-draft-quality.spec.ts`, `tailored-draft.spec.ts`; benchmark: `test/manual/tailored-cv.eval.ts`.
- Không đổi UI, schema đầu ra AI, API, DB.

## 7. Công cụ chẩn đoán đã thêm (Phase A)

`apps/api/test/manual/tailored-cv.eval.ts`:

- Lần chạy thật: mỗi kết quả có `sections` (đếm theo phần: ứng viên/hiển thị/cần xác nhận/bị ẩn) và `diagnostics` (từng ứng viên: phần, field, kết quả, lý do chính xác, trước/sau, số từ lý do).
- `--replay <tệp.json>`: phát lại đầu ra thô đã lưu qua chính `assembleDraft`/`weakened`/`lowValue`, không gọi AI.
- Chỉ dùng dữ liệu giả; không ghi khóa API hay nội dung CV thật.

## 8. Phase B — kết quả (đề xuất 1–6 đã triển khai; 7 chưa làm)

Chi tiết đánh giá: [tailored-cv-experience-quality-report.md](tailored-cv-experience-quality-report.md).

- Prompt Experience-first (quy trình 3 bước, ví dụ tốt/xấu trung tính, cấm trả lại câu gần như không đổi), Summary theo mẫu tách tổng kinh nghiệm khỏi Java, lý do một câu 15–25 từ.
- Ngân sách theo phần trong `assembleDraft`: tối đa 1 Summary, 2 Skills hiển thị, theo thứ tự ưu tiên của mô hình (`SECTION_LIMITS`, mã `section_cap`).
- Chẩn đoán không chứa văn bản: `generationMetadata.decisions.sections` — theo phần: `candidates`, `shown`, `confirm`, `hidden`, `reasons` (`identical`, `weakened_<nhóm>`, `low_value`, `section_cap`, `unchanged`), `reasonWordsAvg`.
- Skills: bỏ nhãn nhóm ("Databases:") trước khi so; chỉ hiển thị khi sửa ≥2 cặp lệch hoặc đưa kỹ năng JD bắt buộc vào 3 vị trí đầu.
- Sửa lỗi bộ lọc văn bản: xóa một từ đứng trước từ khóa JD không còn được coi là "đưa từ liên quan lên trước".

Kết luận chính: trên CV dạng Technical Lead đã viết tốt (bộ java-backend), mô hình vẫn chỉ tạo các sửa đổi Experience mang tính sắp xếp lại/không đổi; sau khi lọc, **0 gợi ý Experience** được hiển thị. Không có lọc nhầm (0/17 trên lần chạy sau). Giá trị Experience còn lại cho loại CV này nằm ở đề xuất 7 (ưu tiên/sắp xếp gạch đầu dòng), cần thiết kế và phê duyệt riêng.
