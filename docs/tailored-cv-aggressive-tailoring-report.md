# Tailored CV: tùy chỉnh mạnh tay, có căn cứ

> Ví dụ trong tài liệu này dùng dữ liệu giả đã ẩn danh; câu chữ có thể khác với lần chạy gốc ở chi tiết nhận dạng (lĩnh vực, số liệu, công cụ, ngày tháng).

Báo cáo cho nhiệm vụ "Aggressive Tailoring with Evidence-Grounded Safety". Chỉ thay đổi backend (prompt và kiểm tra xác định); không đổi UI, template, PDF/DOCX, CV Match, schema hay cơ sở dữ liệu. Mọi dữ liệu đánh giá là dữ liệu giả.

## 1. Nguyên nhân gốc

Luồng: CV đã rà soát + JD + CV Match → `buildPrompt` ([tailored-draft.generator.ts](../apps/api/src/tailored-cv/tailored-draft.generator.ts)) → 1 lời gọi AI có schema → `validateOpportunities` → `assembleDraft` ([tailored-draft.policy.ts](../apps/api/src/tailored-cv/tailored-draft.policy.ts)) → quyết định của người dùng (`applyReview`, [tailored-draft-review.policy.ts](../apps/api/src/tailored-cv/tailored-draft-review.policy.ts)) → bản nháp lưu → duyệt → export.

| Hiện tượng                                                       | Nguyên nhân trong mã                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Led the development" → "Developed"; Summary bỏ "Technical Lead" | Không có kiểm tra nào cho việc **làm yếu** nội dung; các kiểm tra hiện có (số mới, chi tiết mượn dòng khác, claim trong Summary) chỉ bắt nội dung **thêm vào**. Prompt chỉ có một câu chung về "preserve leadership". |
| Skills chỉ đảo vài mục (Node.js lên trước Hibernate)             | Không có tiêu chí "đảo có ích". Prompt chỉ nói "reorder so the most job-relevant come first".                                                                                                                         |
| Gợi ý chỉ đổi từ đồng nghĩa                                      | Không có ngưỡng chất lượng; bộ lọc duy nhất là bỏ đề xuất chỉ khác khoảng trắng.                                                                                                                                      |
| Lý do dài, liệt kê yêu cầu JD                                    | Prompt yêu cầu "which job need it serves" → mô hình liệt kê yêu cầu. Schema cho phép 350 ký tự.                                                                                                                       |
| Summary chỉ chèn danh sách công nghệ                             | Prompt không cho phép/khuyến khích viết lại mạnh, không nói cách định vị.                                                                                                                                             |

Đánh giá các câu hỏi trong yêu cầu:

1. **Làm được với schema hiện tại**: mọi thay đổi ở đây (prompt, lọc chất lượng, chống làm yếu, tiêu đề Summary). Không cần đổi hợp đồng API hay migration.
2. **Cần đổi schema**: gộp/tách gạch đầu dòng, đổi thứ tự gạch đầu dòng trong một mục, đề xuất rút gọn nội dung ít liên quan (xóa/ẩn một dòng) — schema chỉ hỗ trợ viết lại một fact. Đề xuất mở rộng nhỏ nhất (chưa làm): thêm `proposals[].kind: "rewrite" | "omit"` với `omit` dùng đường `include: false` sẵn có.
3. **Giới hạn 5**: đủ. Mô hình trả 3–5, sau lọc hiển thị 0–3.
4. **Kiểm tra từ chối nhầm**: tìm thấy và sửa — "5 years, 4 of them with Java" không được coi là bằng chứng cho "4 years with Java".
5. **Có thể lách bằng diễn đạt lại**: có — kiểm tra từ vựng không bắt được phóng đại không dùng từ khóa (xem mục 12).
6. **Có thể làm yếu trách nhiệm/thành tích**: có (đã thấy trong baseline) — nay bị chặn.

## 2. Chiến lược prompt: trước và sau

|                   | Trước                                                      | Sau                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mục tiêu          | "present … so a recruiter quickly sees why it is relevant" | Thêm: "Produce a stronger, more relevant, concise and credible CV for this particular job, using only evidence supported by the candidate's CV. The job decides what matters most; the CV is the only source of facts." |
| Summary           | định vị bằng bằng chứng; phân biệt tổng năm/năm công nghệ  | Được viết lại mạnh: mở đầu bằng định vị + thế mạnh đã xác minh (giữ Technical Lead), không liệt kê từ khóa, giảm nổi bật đào tạo/chứng chỉ ít liên quan, chỉ dùng chức danh CV có                                       |
| Skills            | xếp lại theo liên quan                                     | Thêm: đưa công nghệ JD và hệ sinh thái trực tiếp (framework, ORM, CSDL) lên đầu, nhóm mục liên quan, không đưa mục kém liên quan lên trước, không đề xuất nếu đã hợp lý                                                 |
| Experience        | dẫn bằng hành động liên quan                               | Thêm: giữ/làm mạnh động từ đã xác minh (led, owned, designed, architected) và mọi số liệu; không đổi thành "developed/worked on"; bỏ từ thừa                                                                            |
| Ngưỡng chất lượng | "prefer the original when it already works"                | Thêm: mỗi đề xuất phải có lợi ích nhìn thấy; cấm đổi từ đồng nghĩa, sửa 1–2 từ, đảo thứ tự cho có, lặp ý, chung chung hơn, nhồi từ khóa; ít bằng chứng → đề xuất ít và hỏi; "Five is a maximum, not a target"           |
| Lý do             | một câu, "which job need it serves"                        | Tối đa hai câu ngắn (~30 từ), nói đã đổi gì và vì sao có ích, phải khớp văn bản đề xuất, không liệt kê yêu cầu JD                                                                                                       |

Các quy tắc an toàn trước đó giữ nguyên (không bịa, không mượn từ dòng khác, phân biệt tổng năm/năm công nghệ, giữ trạng thái CV Match). Prompt tăng ~1,1 KB (khoảng +330 token input).

## 3. Tệp thay đổi

- `apps/api/src/tailored-cv/tailored-draft.generator.ts` — prompt.
- `apps/api/src/tailored-cv/tailored-draft.policy.ts` — `weakened`, `lowValue`, kiểm tra tiêu đề Summary, bằng chứng "N of them", sửa mẫu "technical lead"; `assembleDraft` ẩn đề xuất làm yếu/ít giá trị.
- `apps/api/test/unit/tailored-draft-quality.spec.ts` (mới); cập nhật `tailored-draft-grounding.spec.ts`, `tailored-draft.spec.ts`, `tailored-draft-review.spec.ts`.
- `apps/api/test/manual/tailored-cv.eval.ts` — benchmark theo kịch bản (8 bộ dữ liệu giả), ghi đề xuất thô trước khi lọc.
- Tài liệu này.

## 4. Lớp kiểm tra (xác định, không gọi AI thêm)

Áp dụng trong `assembleDraft`, cho mọi đề xuất:

**A. Claim không có căn cứ → cần xác nhận (giữ nguyên + mở rộng)**

- Có sẵn: số mới, chi tiết mượn dòng khác, kỹ năng mới, claim Summary (số năm theo phạm vi, chức danh, lãnh đạo, chuyên môn, kết quả).
- Mới: **chức danh mở đầu Summary** — từ trong cụm chức danh mở đầu (đến động từ/“with”/“and”, tối đa 6 từ) phải có trong chức danh cũ hoặc một chức danh trong CV. Bắt "Technical Lead" cho người là Software Developer, "Senior Java Developer" cho người có chức danh Full-Stack.
- Sửa: "5 years …, 4 of them with Java" là bằng chứng cho "4 years with Java"; mẫu chức danh nay gồm "technical lead".

**B. Làm yếu nội dung → ẩn đề xuất, giữ bản gốc** (`weakened`)

- Nhóm lãnh đạo (led, managed, mentored, headed, spearheaded, dẫn dắt, hướng dẫn…), sở hữu/thiết kế (owned, architected, designed, introduced, thiết kế, phụ trách…), chức danh (senior, technical lead, manager…): nếu bản gốc có nhóm đó mà đề xuất không còn từ nào của nhóm → làm yếu. Đổi trong nhóm ("Led" → "Managed") không bị coi là làm yếu.
- Số liệu của bản gốc bị bỏ (ví dụ 800 ms → 200 ms) → làm yếu. Riêng Summary được phép bỏ số liệu (gạch đầu dòng vẫn giữ), nhưng không được bỏ lãnh đạo/chức danh.

**C. Giá trị thấp → ẩn đề xuất** (`lowValue`)

- Skills cùng tập mục: chỉ hiện khi thứ tự mới giảm số cặp "mục JD nhắc tới đứng sau mục JD không nhắc tới"; đổi bố cục (cùng thứ tự, ví dụ thành danh sách gạch đầu dòng) vẫn hiện; bỏ mục → ẩn.
- Văn bản: ẩn khi chỉ thêm ≤2 và bỏ ≤2 từ nội dung (tổng ≤3), không thêm từ có trong JD, không thêm số, và không đưa từ liên quan JD lên sớm hơn; hoặc chỉ sắp xếp lại các từ cũ mà không đưa từ liên quan lên trước.

**D. Xác nhận**: không đổi — claim không chắc chắn vẫn phải tick và backend kiểm tra khớp chính xác; không gỡ kiểm tra nào để tăng tỷ lệ chấp nhận. Đề xuất bị ẩn không bao giờ vào CV; số lượng bị ẩn được ghi trong `generationMetadata.decisions.formattingOnlySuppressed`.

Không thêm lời gọi AI tự đánh giá: các vấn đề quan sát được (làm yếu, đổi từ đồng nghĩa, đảo cho có) bắt được bằng kiểm tra xác định; một lời gọi thứ hai sẽ gấp đôi chi phí/độ trễ mà chưa có bằng chứng cần thiết.

## 5. Phương pháp benchmark AI thật

- Provider/mô hình: OpenAI `gpt-5.4-mini-2026-03-17` qua tích hợp sẵn có (`pnpm --filter @ai-job-hunter/api eval:tailored --dataset <tên> --runs <n>`), cùng mô hình và cấu hình cho trước/sau.
- Ngân sách đặt trước: **30 request**; đã dùng **25**, 0 lỗi, không gặp giới hạn provider.
- 8 bộ dữ liệu giả (trong `tailored-cv.eval.ts`):

| Bộ       | Kịch bản                                                                                             | Kỳ vọng                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| techlead | 1 + 3: CV đa công nghệ, Technical Lead đã xác minh, "Led the development…"; JD Senior Java Developer | Summary định vị lại, giữ lãnh đạo; Skills đưa Java/Spring/Hibernate lên |
| ordered  | 2: Skills đã hợp lý cho JD Java                                                                      | Không có gợi ý Skills                                                   |
| senior   | 4: tổng 6 năm, Java 3 năm; JD đòi Senior/5+ năm Java/lãnh đạo                                        | Không gán 6 năm cho Java, không thêm Senior/lãnh đạo                    |
| payments | 5: JD có Kafka/Kubernetes/AWS, CV không có                                                           | Không thêm công nghệ thiếu                                              |
| metrics  | 6: có số liệu (800→200 ms, 30%)                                                                      | Giữ nguyên số liệu                                                      |
| thin     | 7: rất ít bằng chứng                                                                                 | Kiềm chế, hỏi thay vì viết lại                                          |
| vi       | 8: CV và JD tiếng Việt                                                                               | Hoạt động bằng tiếng Việt                                               |

- Trước: prompt cũ, 8 request (techlead ×2). Sau: prompt mới, 10 request (techlead, ordered, metrics ×2). Hoàn thiện: 7 request sau khi thêm quy tắc chức danh và sửa kiểm tra.
- Thang điểm 1–5 (do người đánh giá chấm trên đầu ra thực tế, không phải số đo tự động): liên quan JD; cải thiện thực chất; sức mạnh bằng chứng; chính xác (claim không căn cứ đều bị gắn cờ); giữ nghĩa (không làm yếu); chất lượng lý do; giá trị thực tế.

## 6. Ví dụ trước/sau

**Summary — techlead**

- Gốc: "Senior Full-Stack Engineer and Technical Lead with 6+ years of experience building business applications across logistics, healthcare and retail clients. Leads a team of 5 developers and owns technical design and delivery. Completed a Scrum Master course in 2025."
- Trước: giữ nguyên câu, chèn "Experienced in Java, Spring Boot, REST API design, and PostgreSQL." — không định vị lại, Scrum Master vẫn nổi bật.
- Sau: "Technical Lead and Senior Full-Stack Software Engineer with 6+ years of experience building business applications. Leads a team of 5 developers and owns technical design and delivery across Java, Spring Boot, REST APIs, PostgreSQL, MyBatis, Docker, and Git." — Lý do: "Repositions the profile around the target backend role and foregrounds the verified Technical Lead experience. It keeps the strongest relevant technologies and leadership while removing less relevant domain and training detail."

**Skills — techlead**

- Gốc: "Java, Spring Boot, Hibernate, MyBatis, Node.js, NestJS, Express.js, PHP, Laravel, React, Vue.js, PostgreSQL, SQL Server, MySQL, Docker, Git"
- Sau: "Java, Spring Boot, Hibernate, PostgreSQL, MyBatis, Docker, Git, Node.js, NestJS, Express.js, PHP, Laravel, React, Vue.js, SQL Server, MySQL" (hệ sinh thái Java và CSDL lên trước, nhóm JS/PHP xuống sau). Nếu mô hình đưa Node.js lên trước Hibernate, kiểm tra C ẩn đề xuất.

**Experience — techlead**

- Gốc: "Led the development of core billing features using Java Spring Boot, MyBatis, JSP, and SQL Server."
- Trước (cả 2 lần chạy): "Developed core billing features …" — mất lãnh đạo, vẫn hiển thị.
- Sau: mô hình giữ "Led the development…" chỉ đổi "using" → "with" → bị ẩn vì không có giá trị; bản gốc giữ nguyên. Nếu mô hình vẫn đổi thành "Developed", kiểm tra B ẩn.

**Experience — metrics**

- Gốc: "Worked on many different things in the billing team, such as APIs, databases and some deployments."
- Sau: "Worked on billing APIs and databases, including deployments." (gọn hơn, vẫn hiển thị). Dòng có số liệu "800 ms → 200 ms" không bị viết lại.

**Summary — vi**

- Gốc: "Lập trình viên với 5 năm kinh nghiệm phát triển phần mềm, trong đó 3 năm làm backend với Java và Spring Boot. Chăm chỉ, ham học hỏi."
- Sau: "Lập trình viên backend với 5 năm kinh nghiệm phát triển phần mềm, trong đó 3 năm làm backend với Java và Spring Boot." — Lý do: "Đưa kinh nghiệm backend với Java và Spring Boot lên đầu để khớp hơn với vai trò mục tiêu. Giữ ngắn gọn và bỏ mô tả chung chung ít giá trị tuyển dụng."

## 7. Trường hợp đúng là không có gợi ý

- ordered (lần hoàn thiện): mô hình trả lại 4 văn bản giống hệt bản gốc → không hiển thị gợi ý nào; Skills không bị đảo. (Ở lần "sau" trước khi thêm quy tắc chức danh, 0/2 lần có gợi ý Skills.)
- Các gợi ý Skills kiểu đổi chỗ Git/Docker, "helped onboard", "dùng" → "sử dụng", "Designed … used by" → "for", "Designed and owned" đều bị ẩn (xem kiểm tra C).
- thin: Skills "Java, SQL" giữ nguyên; mô hình đặt câu hỏi về công nghệ thay vì bịa.

## 8. Trường hợp vẫn cần xác nhận

| Bộ                   | Đề xuất                                                                                                                                                  | Ghi chú xác nhận                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| senior               | "Technical Lead with 6 years of experience in web development. Has used Java for the last 3 years and worked with Spring Boot." (CV: Software Developer) | `"3 years and worked with Spring Boot"; headline title: "Technical Lead"` — chức danh bịa bị bắt bởi kiểm tra mới |
| ordered              | "Senior Java backend developer with 5 years…"                                                                                                            | `title or seniority: Senior`                                                                                      |
| thin                 | "Senior Java Developer with experience in backend development…"                                                                                          | `title or seniority: Senior`                                                                                      |
| techlead             | "Senior Technical Lead … 6+ years … and leading a team of 5 developers"                                                                                  | `"6+ years of experience building business applications and leading a"` (gán 6 năm cho lãnh đạo)                  |
| payments             | "Backend developer with 4 years of experience building payment and reconciliation services"                                                              | `"4 years of experience building payment and reconciliation services"`                                            |
| payments, senior, vi | dòng kinh nghiệm thêm "payment reconciliation service", "logistics", "hệ thống"                                                                          | chi tiết mượn từ dòng khác                                                                                        |

## 9. Điểm đánh giá và hạn chế quan sát

| Tiêu chí                           | Trước | Sau |
| ---------------------------------- | ----- | --- |
| Liên quan JD                       | 3     | 4   |
| Cải thiện thực chất                | 2     | 3,5 |
| Sức mạnh bằng chứng                | 3     | 4   |
| Chính xác (claim lạ đều bị gắn cờ) | 3     | 4   |
| Giữ nghĩa (không làm yếu)          | 2     | 5   |
| Chất lượng lý do                   | 3     | 4   |
| Giá trị thực tế                    | 2     | 3,5 |

Số liệu tổng hợp: Trước — 27 gợi ý hiển thị/8 lần chạy, trong đó 2 làm yếu lãnh đạo và ~8 giá trị thấp (đối chiếu offline). Sau và hoàn thiện — 0 gợi ý làm yếu được hiển thị; mô hình trả 3–5, hiển thị 0–3/lần; mọi chức danh/thâm niên không căn cứ đều cần xác nhận.

Hạn chế quan sát:

- Gợi ý Experience ít hơn: mô hình thường chỉ sửa nhẹ gạch đầu dòng, và các sửa nhẹ đó nay bị ẩn. Kết quả là ít gợi ý hơn nhưng chất lượng cao hơn; cải thiện Experience thực chất vẫn phụ thuộc mô hình.
- "Senior Technical Lead" (ghép "Senior" có sẵn với "Technical Lead" có sẵn) không bị gắn cờ dù là cách gọi mới.
- Lý do đã ngắn và không liệt kê yêu cầu, nhưng đôi khi chung chung ("easier to scan").
- techlead lần chạy 0 gắn danh sách công nghệ vào "owns technical design and delivery across …" — không bị gắn cờ.

## 10. Độ trễ, token, chi phí

| Giai đoạn  | Request | Input TB | Output TB | Độ trễ TB |
| ---------- | ------- | -------- | --------- | --------- |
| Trước      | 8       | 1.845    | 456       | 3,8 s     |
| Sau        | 10      | 2.104    | 487       | 3,6 s     |
| Hoàn thiện | 7       | 2.177    | 509       | 3,7 s     |

Tổng 25 request: 51.040 token input (10.496 cached), 12.079 token output, 0 token reasoning; độ trễ 2,8–6,0 s (trung vị 3,6 s); 0 lỗi, 0 retry. Chi phí: repo không có bảng giá và provider không trả chi phí → **không ghi nhận**; có thể tính từ số token theo bảng giá hiện hành. Prompt mới tăng ~15% input, ~10% output mỗi lần tạo draft; vẫn 1 lời gọi.

## 11. Kiểm thử tự động

- API unit: **3634 PASS** (mới: `tailored-draft-quality.spec.ts` — giữ lãnh đạo, chống làm yếu số liệu, chặn Skills đảo cho có, cho phép đảo có ích và đổi bố cục, đổi từ đồng nghĩa bị ẩn, cho phép viết lại thực chất/thêm số (để xác nhận), tiêu đề Summary, "N of them", generator chỉ hiển thị gợi ý đáng giá và đếm số bị ẩn; các test cũ về xác nhận/sửa/giữ gốc, số năm, claim Summary vẫn chạy).
- Integration (DB test riêng): **198 PASS** (review → duyệt → export PDF/DOCX, xác nhận rồi chấp nhận, chủ sở hữu khác).
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, Prettier các tệp thay đổi: PASS.
- Không chạy browser QA: không thay đổi UI.

## 12. Rủi ro còn lại

- Kiểm tra dựa trên từ vựng: phóng đại không dùng từ khóa ("drove the platform strategy"), hoặc ghép các chức danh có sẵn thành chức danh mới, không bị bắt.
- `lowValue` đếm âm tiết tiếng Việt như từ, nên cụm hai âm tiết có thể bị coi là "nhỏ" — có thể ẩn nhầm một sửa ngắn có ích; ghi chú mượn chi tiết tiếng Việt có thể chỉ hiện một âm tiết ("thống").
- Độ liên quan JD xác định bằng việc JD có nhắc tên mục; JD không nhắc "MyBatis" thì MyBatis được coi là kém liên quan dù cùng hệ sinh thái Java.
- Đề xuất bị ẩn không hiển thị cho người dùng (chỉ ghi trong metadata). Nếu bộ lọc quá chặt với một CV cụ thể, người dùng sẽ thấy ít gợi ý.
- Benchmark nhỏ (25 request, 1–3 mẫu/kịch bản); chưa đo với mô hình local (qwen3:4b) hay CV thật.

## 13. Checklist kiểm thử thủ công

1. Dùng một job Java có JD đầy đủ và CV đã rà soát (CV có chức danh lãnh đạo nếu có). Vào "CV tùy chỉnh" → tạo gợi ý (1 lời gọi AI).
2. Summary: kiểm tra có được viết lại theo vị trí, giữ chức danh/lãnh đạo thật (ví dụ Technical Lead), không liệt kê từ khóa, đào tạo/chứng chỉ ít nổi bật hơn. Nếu có chức danh hoặc số năm mới → thẻ phải yêu cầu xác nhận.
3. Skills: nếu có gợi ý, công nghệ JD (Java, Spring Boot, ORM, CSDL) phải lên trước; không có công nghệ kém liên quan nhảy lên trước. Nếu thứ tự gốc đã hợp lý, không có gợi ý Skills.
4. Experience: không gợi ý nào đổi "Led/Designed/Owned…" thành từ yếu hơn hoặc bỏ số liệu; không có gợi ý chỉ đổi 1–2 từ.
5. Lý do: tối đa hai câu, nói đã đổi gì và vì sao; không liệt kê yêu cầu JD.
6. Thử: Chấp nhận một gợi ý thường; Xác nhận và chấp nhận một gợi ý có khung vàng; Sửa cách diễn đạt; Giữ bản gốc → Lưu nháp → xem trước khớp từng quyết định.
7. Bước 3: chọn mẫu, duyệt, tải PDF và DOCX; nội dung khớp quyết định.
8. Ghi lại các gợi ý bạn thấy thiếu (ví dụ một dòng Experience đáng ra nên được cải thiện) — giúp quyết định có nới bộ lọc giá trị thấp hay không.
