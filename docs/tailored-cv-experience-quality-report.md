# Báo cáo đánh giá: chất lượng gợi ý Experience (Phase B)

> Ví dụ trong tài liệu này dùng dữ liệu giả đã ẩn danh; câu chữ có thể khác với lần chạy gốc ở chi tiết nhận dạng (lĩnh vực, số liệu, công cụ, ngày tháng).

Dữ liệu giả, mô hình OpenAI `gpt-5.4-mini-2026-03-17` qua tích hợp sẵn có. Bộ java-backend dùng JD diễn đạt lại từ tin TopCV công khai "Lập trình viên Java từ 3 năm kinh nghiệm" (không chép nguyên văn, không có tên công ty, lương, liên hệ) và CV ẩn danh có cấu trúc giống CV đa công nghệ của Technical Lead.

## Phương pháp

- Năm bộ: java-backend, techlead (Senior Java / Technical Lead), fullstack, ordered (CV đã khớp), thin (thiếu bằng chứng); mỗi bộ 2 lần chạy cho baseline và sau thay đổi.
- Số liệu lấy từ chế độ chẩn đoán của `apps/api/test/manual/tailored-cv.eval.ts` (đếm theo phần, lý do ẩn, số từ lý do) và chấm tay từng gợi ý.
- "Lọc nhầm" = gợi ý bị ẩn nhưng là cải thiện thực chất, được xác định bằng đọc thủ công.

## Kết quả

| Chỉ số (10 lần chạy mỗi bên)           | Baseline                                      | Sau thay đổi                                                                                                                    |
| -------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Ứng viên Summary / Skills / Experience | 10 / 20 / 14                                  | 9 / 8 / 22                                                                                                                      |
| Experience hiển thị (+ cần xác nhận)   | 3 (+1)                                        | 4 (+1)                                                                                                                          |
| Experience có ý nghĩa (chấm tay)       | 1 ("Worked on many…"-loại; trong 5 bộ này: 1) | 2 ("Delivered warehouse modules for 300+ staff by leading a 5-member team…", "Implemented PostgreSQL reporting queries…" — nhỏ) |
| Skills hiển thị (+ cần xác nhận)       | 10 (+1), phần lớn đảo vị trí láng giềng       | 1 (+1)                                                                                                                          |
| Gợi ý tầm thường được hiển thị         | ~11 (Skills đảo láng giềng, "using"→"with")   | 1–2 (đổi chỗ PostgreSQL trong một câu; CI/CD đổi thứ tự)                                                                        |
| Lọc nhầm                               | 0                                             | 0 / 17 Experience bị ẩn                                                                                                         |
| Làm yếu bị chặn                        | —                                             | 1 ("Led the design" → "Designed")                                                                                               |
| Số từ lý do (trung bình / tối đa)      | 29–37 / 57                                    | 17–19 / 25                                                                                                                      |
| Token vào / ra trung bình              | 2.639 / 549                                   | 2.889 / 419                                                                                                                     |
| Độ trễ trung vị (min–max)              | 4,1 s (2,3–7,4)                               | 3,7 s (1,5–4,7)                                                                                                                 |

Ghi chú baseline: phát lại đầu ra baseline qua bộ lọc mới cho thấy riêng bộ lọc đã giảm Skills hiển thị 10 → 5 và Experience 3 → 2; phần còn lại đến từ prompt.

### java-backend (gần CV thật nhất)

- Summary — gốc: "Senior Full-Stack Engineer and Technical Lead with 6+ years of experience building business applications…". Sau: "Technical Team Lead with 6+ years of experience building business applications in logistics, healthcare and retail. Hands-on in Java and Spring Boot backend development, microservices, REST…" — tổng 6+ năm giữ cho "business applications", Java nêu riêng (đúng mẫu); "Technical Team Lead" là chức danh có trong CV.
- Skills: mô hình trả lại nguyên văn các nhóm → ẩn; không còn đảo RabbitMQ/Asynchronous Messaging.
- Experience: chỉ đổi thứ tự công nghệ hoặc giữ nguyên → ẩn; **0 hiển thị**.
- Lý do: "Nhấn mạnh nền tảng Java Spring và kiến trúc doanh nghiệp từ đầu, giúp nhà tuyển dụng thấy ngay mức độ phù hợp." (23 từ).

### Phát hiện trong quá trình đánh giá

- Ví dụ "useful rewrite" ban đầu trong prompt trùng một gạch đầu dòng của bộ java-backend; mô hình chép gần nguyên văn → kết quả bị thổi phồng. Đã thay bằng ví dụ trung tính và chạy lại java-backend (2 request); các số trên dùng lần chạy sạch.
- Mô hình thường trả lại câu y hệt kèm lý do mô tả một thay đổi không có; bộ lọc `identical` ẩn các trường hợp này.

## Gợi ý không an toàn hoặc giá trị thấp còn lại

- Cần xác nhận (đúng): "Worked on backend tasks in Java." (thin) — chi tiết Java không có trong dòng.
- Giá trị thấp nhưng vẫn hiển thị: "Implemented reporting queries in PostgreSQL…" → "Implemented PostgreSQL reporting queries…" (đưa từ JD lên trước — theo quy tắc là có ích, thực tế nhỏ); "Optimized Docker image builds… in Jenkins pipelines…".
- Không thấy gợi ý bịa được hiển thị mà không có cờ xác nhận.

## Sử dụng AI

- 22/26 request (10 baseline, 10 sau thay đổi, 2 chạy lại java-backend sau khi loại ví dụ trùng); 0 lỗi; không dừng sớm.
- Tổng 62.790 token vào, 10.845 token ra; độ trễ 1,5–7,4 s.
- Chi phí: không ghi nhận (repo không có bảng giá, provider không trả chi phí).

## Kiểm thử

- API unit 3.639 PASS (mới/cập nhật trong `tailored-draft-quality.spec.ts`: thứ tự Experience-first trong prompt, không ép gợi ý, nhóm Skills có nhãn, ngưỡng Skills, ngân sách theo phần và mã `section_cap`, chẩn đoán không chứa văn bản, xóa từ trước từ khóa JD, giữ lãnh đạo/số liệu; các test xác nhận/sửa/giữ gốc/duyệt hiện có vẫn chạy).
- Integration 198 PASS; lint, typecheck, build, Prettier: PASS.

## Rủi ro và khuyến nghị

- Với CV đã viết tốt, gợi ý Experience dạng viết lại gần như luôn là sắp xếp lại → bị ẩn đúng. Muốn có giá trị Experience thật cho loại CV này cần đề xuất 7 (ưu tiên gạch đầu dòng/vai trò liên quan JD) — cần thiết kế và phê duyệt riêng.
- Quy tắc "đưa từ JD lên trước" vẫn cho qua một số sửa nhỏ; có thể nâng ngưỡng (ví dụ yêu cầu thêm một thay đổi nội dung) nếu thấy phiền khi test tay.
- Benchmark nhỏ (2 mẫu/bộ); chưa đo với CV thật hay mô hình local.
- `decisions.sections` cũng được ghi vào log ứng dụng (chỉ số đếm và mã).
