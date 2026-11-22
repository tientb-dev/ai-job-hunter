# Tailored CV: gợi ý bám JD, xác nhận trước khi chấp nhận, ưu tiên PDF

Báo cáo triển khai và đánh giá cho [tailored-cv-suggestion-audit.md](tailored-cv-suggestion-audit.md). Dữ liệu dùng để đánh giá và kiểm thử đều là dữ liệu giả.

## A. Nguyên nhân gốc (đã đối chiếu với mã)

| Vấn đề                                  | Xác nhận trong mã                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gợi ý chung chung                       | `buildPrompt` ([tailored-draft.generator.ts](../apps/api/src/tailored-cv/tailored-draft.generator.ts)) chỉ gửi danh sách yêu cầu từ CV Match, **không** gửi tiêu đề, seniority, kỹ năng ưu tiên hay nội dung JD (dù có sẵn trong `input.job`). Schema giới hạn **2** đề xuất. Prompt gần như chỉ có ràng buộc, không có mục tiêu cho từng phần. |
| Không chấp nhận được gợi ý cần xác nhận | `assembleDraft` gắn `requiresConfirmation`; `ProposalComparison` khóa nút; `applyReview` từ chối `accept`. Không có thao tác "xác nhận rồi chấp nhận".                                                                                                                                                                                          |
| Export                                  | Thứ tự `['docx','pdf']`, DOCX là nút chính trong wizard; mỗi lần tải gọi `setMessage(...)` → popup thành công.                                                                                                                                                                                                                                  |

Khác biệt so với audit: không có. Phát hiện thêm khi QA: thẻ gợi ý đã chấp nhận rồi được sửa vẫn hiện "Dùng gợi ý: …" dù CV dùng văn bản đã sửa (đã sửa, xem B).

## B. Thay đổi

**Prompt** (`buildPrompt`)

- Thêm khối `TARGET JOB` (title, seniority, domain, experience, required/preferred skills, JD trích 3.000 ký tự đầu, đánh dấu là dữ liệu).
- Mục tiêu theo phần: Summary định vị theo vai trò bằng bằng chứng có thật; Skills chỉ sắp xếp lại, không thêm; Experience nêu hành động liên quan, công nghệ đã có, phạm vi và mục đích; không chỉ đổi từ đồng nghĩa.
- Giữ các quy tắc an toàn: giữ chủ thể/ownership/phạm vi/giới hạn, không lấy chi tiết từ dòng khác, chỉ dùng thuật ngữ JD khi fact đã thể hiện, không bịa; thời lượng dự án và tổng số năm kinh nghiệm không áp cho kỹ năng/vai trò hẹp hơn; giữ trạng thái CV Match (kể cả NOT_EVIDENCED).

**Giới hạn đề xuất**: 2 → `MAX_PROPOSALS = 5`. Vẫn 1 lời gọi AI mỗi lần tạo draft.

**Kiểm tra xác định (không AI)**, trong `assembleDraft` ([tailored-draft.policy.ts](../apps/api/src/tailored-cv/tailored-draft.policy.ts)):

- `newNumbers`: số trong gợi ý không có trong fact gốc (bỏ qua dấu phân cách và `%`, nên "1,000"="1000", "50"→"50%" không bị gắn cờ).
- `importedTerms`: dòng Experience/Projects thêm từ (≥4 ký tự) chỉ có ở dòng khác của cùng mục; Skills thêm bất kỳ mục nào không có trong danh sách. Summary không áp dụng (được phép tổng hợp từ CV).
- Khi có phát hiện và mô hình chưa tự gắn `confirmationAssertion`, gợi ý chuyển thành "cần xác nhận" với lời giải thích cụ thể ("Numbers not in your CV: 4" / "Chi tiết lấy từ dòng khác của mục này: …").

**Xác nhận rồi chấp nhận**

- API (`reviewRequest`/`applyReview`, [tailored-draft-review.policy.ts](../apps/api/src/tailored-cv/tailored-draft-review.policy.ts)): `accept` có thể kèm `confirmed: { assertion, text }`. Với gợi ý cần xác nhận, chỉ chấp nhận khi **cả hai** khớp chính xác claim và văn bản gợi ý đang lưu; thiếu, sai claim hoặc văn bản cũ → 400. Gửi `confirmed` cho gợi ý thường → 400. Lưu `factReviews[id].userConfirmed = { assertion, confirmedAt }`; bất kỳ quyết định từ ngữ nào sau đó xóa nó. Không cần migration (JSON review).
- UI (`ProposalComparison`): hiện chi tiết cần kiểm tra, hướng dẫn ba lựa chọn, checkbox "Tôi xác nhận thông tin này đúng với kinh nghiệm thực tế của mình." (không chọn sẵn, gắn với đúng văn bản gợi ý), nút "Xác nhận và chấp nhận"; "Sửa cách diễn đạt" và "Giữ bản gốc" giữ nguyên. Gợi ý bị gắn cờ mà không có claim cụ thể vẫn không thể chấp nhận trực tiếp.
- Thẻ đã chấp nhận rồi sửa: trạng thái và dòng mô tả ưu tiên "Dùng cách diễn đạt bạn đã sửa".

**Export** (`TailoredCvReview`): PDF trước, nút chính (filled); DOCX sau, outlined; bỏ popup thành công sau khi tải. Giữ chỉ báo đang chuẩn bị, lỗi, điều kiện duyệt, khóa PDF khi đang lưu template. PDF theo template đã chọn, DOCX Classic.

**Công cụ đánh giá**: `pnpm --filter @ai-job-hunter/api eval:tailored --variant production --runs 1 --out file.json` ([test/manual/tailored-cv.eval.ts](../apps/api/test/manual/tailored-cv.eval.ts)) — CV/JD giả, từ chối chạy dưới CI, tối đa 3 lần/lần gọi.

## C. Đánh giá AI thật

Mô hình: OpenAI `gpt-5.4-mini-2026-03-17` qua tích hợp sẵn có. Dữ liệu: CV giả (Backend Developer fintech + Junior Full-Stack) và JD "Mid-level Java Backend Engineer" (bắt buộc: Java, Spring Boot, REST, SQL, Docker, unit test; ưu tiên: Kafka, Kubernetes, AWS — không có trong CV).

| Biến thể                                         | Đề xuất/lần | Phần được gợi ý                    | JD  | Cải thiện | Bằng chứng | Chính xác | Dễ đọc | Giải thích | Giá trị | Vấn đề                                                                                                                                 |
| ------------------------------------------------ | ----------- | ---------------------------------- | --- | --------- | ---------- | --------- | ------ | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline (prompt cũ, cap 2)                      | 1, 1        | Experience (1 dòng)                | 2   | 1         | 3          | 3         | 4      | 3          | 1       | Chỉ thêm "Spring Boot" (lấy từ dòng khác, không gắn cờ); bỏ qua Summary/Skills                                                         |
| A (JD + mục tiêu theo phần, cap 5)               | 3, 3        | Summary, Skills, Experience        | 4   | 4         | 4          | 4         | 4      | 4          | 4       | Summary hơi giống danh sách công nghệ; 1 dòng lấy "payment reconciliation service" từ dòng khác                                        |
| B (A + ưu tiên/grounding chặt)                   | 3, 3        | Summary, Skills, Experience        | 4   | 3         | 3          | 2         | 4      | 4          | 3       | Summary phóng đại: "4 years … backend … with Java and Spring Boot"                                                                     |
| C (A + quy tắc thời lượng, chống liệt kê)        | 4, 3        | Summary, Skills, Experience        | 3   | 2         | 3          | 2         | 4      | 3          | 2       | Viết lại chỉ đổi từ đồng nghĩa; Summary vẫn phóng đại                                                                                  |
| **Production** (A + quy tắc an toàn gốc + cap 5) | 5, 3        | Summary, Skills, 3 dòng Experience | 4   | 4         | 4          | 3 → 4*    | 4      | 4          | 4       | 2 dòng lấy chi tiết từ dòng khác (*đều bị kiểm tra xác định gắn cờ "cần xác nhận"); Summary 1 lần ghi "Backend developer with 4 years" |

Điểm 1–5 do người đánh giá chấm trên đầu ra thực tế; không phải số đo tự động.

Ví dụ (dữ liệu giả):

- Summary — gốc: "Software engineer with 4 years of experience building web applications. Hard-working team player who likes learning new technologies." → A: "Software engineer with 4 years of experience building web applications and backend services with Java, Spring Boot, REST APIs, MySQL, Docker, JUnit and Mockito. Experienced in payment reconciliation, settlement reporting, production bug fixing and on-call support."
- Skills — "JavaScript, React, Java, Spring Boot, MySQL, Git, Docker, HTML, CSS, REST APIs, JUnit" → "Java, Spring Boot, REST APIs, MySQL, Docker, JUnit, JavaScript, React, Git, HTML, CSS" (không thêm Kafka/Kubernetes/AWS ở bất kỳ lần chạy nào).
- Experience — "Wrote SQL queries and stored procedures in MySQL for monthly settlement reports." → "Wrote SQL queries and stored procedures in MySQL to support monthly settlement reports." (chỉ production phát hiện dòng này khớp trách nhiệm "settlement reporting").
- Bị gắn cờ đúng: "Fixed production bugs and took part in the on-call rotation." → "… for the payment reconciliation service." → "Chi tiết lấy từ dòng khác của mục này: payment, reconciliation, service".

Lựa chọn: prompt production. Bằng chứng: tăng từ 1 lên 3–5 gợi ý có ích mỗi lần, phủ Summary/Skills/Experience, không thêm kỹ năng thiếu, không bịa số; các trường hợp lấy chi tiết từ dòng khác bị chặn ở kiểm tra xác định thay vì lọt im lặng. Cap 5 không bị "lấp đầy" bằng gợi ý yếu (A/B/C trả 3–4). C cho thấy thêm quy tắc vào prompt không làm mô hình tuân thủ tốt hơn — vì vậy dùng kiểm tra xác định.

Sử dụng AI: **10 request** (5 biến thể × 2), 0 lỗi, 0 retry, không gặp giới hạn provider. Độ trễ 3,1–5,9 s (thường ~3,5 s). Token: input 1.695–1.882/request (tổng 17.978, một phần cached), output 374–560/request (tổng 4.830), reasoning 0. Chi phí: repo không có bảng giá và provider không trả chi phí trong phản hồi → **không ghi nhận**; tính bằng token × bảng giá hiện hành của OpenAI nếu cần. Prompt production ~7 KB (giới hạn 64 KiB).

## D. Tương thích

- Draft cũ: không đổi; đề xuất cũ giữ nguyên cờ. Đề xuất cũ "cần xác nhận" có claim → nay xác nhận được; không có claim → vẫn chỉ sửa/giữ gốc.
- Quyết định review cũ: hợp lệ; `userConfirmed` là trường tùy chọn. Không migration.
- Duyệt: không đổi — mọi fact không còn là từ ngữ gốc (kể cả đã xác nhận) phải được tick khi duyệt; mọi lần lưu xóa approval.
- PDF/DOCX: cùng `acceptedText`; PDF theo template đã lưu, DOCX Classic. Template Cards P2 và lưu template theo draft giữ nguyên.
- Prompt mới chỉ áp dụng cho draft tạo mới.

## E. Kiểm thử

- API unit: 3615 PASS (thêm `tailored-draft-grounding.spec.ts`, 2 test mới trong `tailored-draft-review.spec.ts`; 4 test cập nhật câu chữ prompt trong `tailored-draft.spec.ts`).
- Integration (DB test): 198 PASS (thêm luồng xác nhận → duyệt → DOCX/PDF, chủ sở hữu khác bị từ chối).
- Web: 795 PASS, 7 skipped (thứ tự/kiểu nút export, không popup thành công, thẻ xác nhận, sửa sau chấp nhận).
- `pnpm lint`, `pnpm typecheck`, `pnpm build`: PASS. Prettier: PASS cho các tệp thay đổi.
- Browser QA (DB test riêng, user/CV/JD/draft giả, AI giả lập cố định, cổng 3100/5180): chấp nhận gợi ý thường, xác nhận và chấp nhận, đổi sang giữ gốc, sửa cách diễn đạt; preview phản ánh từng bước; duyệt; PDF trước/filled, DOCX outlined; tải PDF và DOCX không popup; nội dung tệp tải về đúng văn bản đã sửa/giữ gốc; template cards (Gọn) lưu được, PDF khóa khi đang lưu; 1280px và 375px không tràn ngang; console chỉ có 401 trước khi đăng nhập.

## F. Rủi ro còn lại

- Summary vẫn có thể phóng đại thời lượng/vai trò ("Backend developer with 4 years") — lỗi ngữ nghĩa, không bắt được bằng kiểm tra xác định; người dùng vẫn phải đọc so sánh trước khi chấp nhận.
- `importedTerms` dựa trên từ vựng: có thể bỏ sót khi mô hình diễn đạt lại chi tiết bằng từ khác, và có thể gắn cờ thừa khi một từ thường gặp tình cờ có ở dòng khác (người dùng chỉ cần xác nhận hoặc sửa).
- Đánh giá dựa trên một cặp CV/JD giả, 2 lần mỗi biến thể; kết quả với CV tiếng Việt, ngành khác hoặc mô hình local (qwen3:4b) chưa được đo.
- Token và độ trễ tăng nhẹ (~+4% input, ~+30% output so với baseline); chưa đo trên mô hình local.

## G. Kiểm tra dữ kiện trong Summary (bổ sung)

Nguyên nhân: Summary chỉ được kiểm tra số liệu so với chính câu Summary cũ; số năm, chức danh, vai trò lãnh đạo, mức chuyên môn không được kiểm tra; và khi mô hình tự ghi `confirmationAssertion` thì phát hiện xác định bị bỏ qua.

Thay đổi:

- `summaryClaims` ([tailored-draft.policy.ts](../apps/api/src/tailored-cv/tailored-draft.policy.ts)) so với **toàn bộ CV** (không chỉ Summary cũ):
  - "N years/năm …": hợp lệ khi Summary cũ hoặc một câu khác trong CV nêu cùng N và cùng phạm vi (các từ sau "N years" phải có trong mệnh đề của bằng chứng). Tổng số năm không được chuyển thành số năm với một công nghệ/vai trò hẹp hơn.
  - Chức danh/cấp bậc, lãnh đạo, mức chuyên môn, động từ kết quả: chỉ gắn cờ khi cùng gốc từ không xuất hiện ở bất kỳ đâu trong CV (ví dụ "Senior" hợp lệ nếu CV có chức danh Senior; "mentored" hợp lệ nếu có trong một dòng kinh nghiệm).
  - Số liệu: so với toàn bộ CV.
- Ghi chú xác nhận nay **gộp** ghi chú của mô hình và mọi phát hiện xác định; người dùng xác nhận tất cả cùng lúc bằng luồng sẵn có. Giới hạn độ dài xác nhận ở API tăng 600 → 2000 ký tự (vẫn phải khớp chính xác).
- Prompt Summary thêm một câu phân biệt: tổng kinh nghiệm, số năm với công nghệ cụ thể, chức danh, lãnh đạo thực tế, thành tích đã ghi.

Ví dụ (CV giả: tổng 6 năm, Java 3 năm, chức danh Senior, có "Mentored two junior developers"):

| Summary đề xuất                                                                                   | Kết quả                                                                      |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| "…with 6 years of Java experience"                                                                | Cần xác nhận: `"6 years of Java experience"`                                 |
| "Kỹ sư phần mềm với 6 năm kinh nghiệm Java"                                                       | Cần xác nhận: `"6 năm kinh nghiệm Java"`                                     |
| "Principal engineer…"                                                                             | Cần xác nhận: chức danh Principal                                            |
| "…led a team of engineers…"                                                                       | Cần xác nhận: lãnh đạo (led)                                                 |
| "Java expert…"                                                                                    | Cần xác nhận: mức chuyên môn (expert)                                        |
| "…reduced API latency by 40%"                                                                     | Cần xác nhận: kết quả (reduced), số liệu 40%                                 |
| "…6 years of experience building web applications, including REST APIs with Java and Spring Boot" | Chấp nhận bình thường                                                        |
| "Senior software engineer with 3 years of Java experience"                                        | Chấp nhận bình thường (3 năm Java có trong CV; Senior là chức danh trong CV) |
| "…; mentored junior developers"                                                                   | Chấp nhận bình thường                                                        |

AI thật: 3 request (`gpt-5.4-mini-2026-03-17`, 0 lỗi, 3,2–5,6 s, input 1.734–1.958 token, output 407–532 token; chi phí không ghi nhận). Dữ liệu payments: 1/2 Summary bị gắn cờ ("4 years … web applications and backend services"), 1/2 viết đúng phạm vi ("4 years … web applications, including backend development with Java…") và chấp nhận bình thường. Dữ liệu senior (tổng 6 năm, Java 3 năm, JD yêu cầu Senior/5+ năm Java/lãnh đạo): mô hình giữ đúng "6 years" và "Java … 3 years", không thêm Senior hay lãnh đạo; tự ghi chú "Spring Boot". Chạy lại kiểm tra trên 8 Summary thật trước đây: cả 8 bị gắn cờ vì gán 4 năm cho "backend"/miền nghiệp vụ.

Giới hạn: không kiểm tra từ đứng **trước** con số ("Java and Spring Boot for the last 3 years") vì chủ ngữ được diễn đạt lại tự do (thử nghiệm cho thấy gây báo nhầm); không suy luận thời lượng từ ngày tháng (vì vậy "4 years backend" vẫn cần xác nhận dù ngày tháng có thể ủng hộ); lời phóng đại không dùng từ khóa (ví dụ "drove the platform strategy") không bị bắt; cách diễn đạt ngữ nghĩa mâu thuẫn không được tự động viết lại — chỉ chuyển sang cần xác nhận.
