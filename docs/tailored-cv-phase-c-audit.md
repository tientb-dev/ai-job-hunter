# Phase C audit: ưu tiên Experience theo JD (chỉ thiết kế)

Không thay đổi mã, không gọi AI, không chạm dữ liệu. Ký hiệu: **[XN]** = đã xác nhận bằng đọc mã; **[GT]** = giả định cần kiểm tra khi triển khai.

## 1. Tóm tắt

- Thiếu tùy chỉnh Experience cho CV đã viết tốt không phải do prompt: giá trị nằm ở **thứ tự và mức nổi bật** của gạch đầu dòng, nhưng hệ thống chỉ có thao tác "viết lại một fact". [XN]
- `priorityFactIds` có trong draft nhưng **không được dùng ở đâu** và không biểu diễn độ liên quan JD; không đủ để điều khiển thứ tự. [XN]
- Đề xuất: **Phương án A — sắp xếp lại gạch đầu dòng trong từng vai trò**, xếp hạng **xác định (không gọi AI)** từ liên kết CV Match + kỹ năng/trách nhiệm JD, người dùng chấp nhận/từ chối theo từng vai trò, áp dụng bằng một thao tác review mới. Không cần migration; chỉ mở rộng tương thích ngược cho tài liệu draft (JSON) và thao tác review.
- Preview, PDF, DOCX đã cùng đọc thứ tự `entry.facts`; nếu thứ tự được áp vào chính `entry.facts` khi người dùng chấp nhận thì **không phải sửa renderer**. [XN]

## 2. Kiến trúc hiện tại

| Bước                                   | Tệp / hàm                                                                                                          | Ghi chú                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CV gốc → văn bản → profile có cấu trúc | `extraction/*`, `tailored-cv/source-profile-structure.ts`, `TailoredCvService.capture/createProfile/appendProfile` | Fact có `id` ổn định trong profile; entry Experience = một vai trò (có `employerFactId` khi nhiều vai trò cùng công ty) [XN]                                                                      |
| CV Match                               | `matching/cv-match.ts` (`scoreCvMatch`)                                                                            | Mỗi component yêu cầu có tối đa một `cvQuote` [XN]                                                                                                                                                |
| Kế hoạch draft                         | `reviewedPlan` (`tailored-draft.policy.ts`)                                                                        | `facts` theo thứ tự profile; `candidates` = field có thể viết lại [XN]                                                                                                                            |
| Sinh draft                             | `TailoredDraftGenerator.generate` → `assembleDraft`                                                                | Mỗi entry: `id`, `originalOrder` (vị trí entry trong section), `facts` (thứ tự profile), `priorityFactIds`; mỗi fact: `relevance` từ `savedSourceSupport` (+ `ai_relevance_only` từ đề xuất) [XN] |
| Review                                 | `reviewRequest`/`applyReview` (`tailored-draft-review.policy.ts`), `TailoredDraftService.review`                   | Mọi lần lưu tăng `revision` và xóa `approval`; thao tác hiện có: accept/reject/restore/edit/include/acknowledge/clarification [XN]                                                                |
| Duyệt                                  | `approveReview`                                                                                                    | Fact không còn là từ ngữ gốc phải được tick [XN]                                                                                                                                                  |
| Preview HTML                           | `web/.../TailoredCvPreview.tsx` (`EntryView` nhận `entry.facts`), `cv-layout.ts` (`structuredRows`)                | Xếp theo thứ tự `entry.facts`; ghép tiêu đề với `dates` **liền sau** [XN]                                                                                                                         |
| Preview cục bộ khi chưa lưu            | `TailoredCvReview.tsx` (vòng lặp áp `operations` lên bản sao `document`)                                           | Phải biết thao tác mới để xem trước chưa lưu [XN]                                                                                                                                                 |
| Export                                 | `canonicalExport` → `cvRows` → `renderPdf(…, template)` / `renderDocx` (`tailored-cv-export.ts`)                   | Duyệt `section.entries` rồi `entry.facts` theo thứ tự lưu; Classic/Modern/Compact chỉ khác giao diện, cùng khối [XN]                                                                              |
| Cập nhật CV nguồn từ draft             | `TailoredCvService.sourceUpdate`                                                                                   | Ghép theo `id` fact, không theo vị trí → thứ tự riêng của draft không lan sang CV nguồn [XN cho phần ghép; GT cho mọi nhánh]                                                                      |

Fact Experience có **id ổn định** (`fact.id` = `provenance.profileFactId`), không đổi khi review/edit/export. Thứ tự gốc **có thể khôi phục** nếu lưu danh sách id gốc của entry (hiện chưa lưu riêng, nhưng bằng thứ tự profile đã ghim). [XN]

## 3. Nguyên nhân gốc

1. Không có hợp đồng để biểu diễn "đưa gạch đầu dòng này lên trước" — chỉ có viết lại câu. [XN]
2. Bộ lọc Phase B ẩn đúng các viết lại chỉ đảo thứ tự công nghệ; với CV mạnh, đó là gần như mọi thứ mô hình đề xuất. [XN, từ benchmark Phase B]
3. Thứ tự gạch đầu dòng hiện là thứ tự trong CV gốc, không phụ thuộc JD. [XN]

## 4. So sánh phương án

| Tiêu chí                   | A: sắp xếp trong vai trò                                | B: ưu tiên vai trò + gạch đầu dòng                                                  | C: sắp xếp + rút gọn                                            |
| -------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Lợi ích cho CV mạnh        | Cao: bullet Java/Spring Boot lên đầu mỗi vai trò        | Cao hơn A một chút (đánh dấu vai trò liên quan) nhưng không được đổi thứ tự vai trò | Cao nhất (CV gọn hơn)                                           |
| Độ phức tạp                | Thấp–TB: thao tác review mới + hoán vị an toàn          | TB–cao: cần biểu diễn "nổi bật" trong preview/PDF/DOCX (renderer đổi)               | Cao: rút gọn = viết lại hoặc ẩn → đụng bộ lọc, xác nhận, export |
| Rủi ro sai lệch            | Thấp: không đổi nội dung, nhà tuyển dụng, ngày, vai trò | Thấp nếu chỉ đánh dấu; cao nếu đổi thứ tự vai trò (sai thời gian)                   | Cao: dễ làm mất bằng chứng                                      |
| Kiểm soát người dùng       | Rõ: chấp nhận/từ chối theo vai trò                      | Kém rõ (đánh dấu là trình bày)                                                      | Cần nhiều quyết định                                            |
| Tương thích draft/duyệt    | Tốt: trường tùy chọn, thao tác mới                      | Như A + trường hiển thị                                                             | Dựa trên `include` có sẵn nhưng dễ ẩn nhầm                      |
| Nhất quán preview/PDF/DOCX | Tự động nếu áp vào `entry.facts`                        | Cần sửa 3 renderer                                                                  | Tự động (include) nhưng rủi ro                                  |
| Tương thích ngược          | Tốt                                                     | Tốt                                                                                 | Tốt                                                             |

**Khuyến nghị: A.** B và C để sau: B cần thay đổi renderer; C đã có đường thủ công (`include`) và tự động hóa dễ làm mất bằng chứng.

## 5. `priorityFactIds`

- Tạo trong `assembleDraft`: `selected.filter(id ∈ entry)`, với `selected` = `selectedFactIds` của mô hình = mọi fact có **đề xuất hoặc câu hỏi**, theo thứ tự đầu ra của mô hình. [XN]
- Không được đọc bởi preview, export, review, web. [XN — tìm toàn bộ mã nguồn]
- Ý nghĩa: "fact mà mô hình đã bình luận", **không phải** xếp hạng độ liên quan; bao gồm cả fact có đề xuất bị bộ lọc ẩn hoặc chỉ có câu hỏi; không chứa fact không được chọn. [XN]
- Ổn định: id ổn định; nội dung cố định từ lúc sinh, không đổi khi người dùng sửa/từ chối. [XN]
- Không có trạng thái quyết định của người dùng, không có lý do. [XN]
- **Kết luận: không tái sử dụng để điều khiển thứ tự.** Giữ nguyên (tương thích), không đọc. Cần trường mới.

## 6. Thiết kế đề xuất

### 6.1 Xếp hạng (xác định, không AI)

Cho mỗi entry Experience/Projects, chỉ xét **fact thân bài** (`description`, `text`, `source_passage`) trong một **đoạn liền kề** không có fact tiêu đề/ngày xen giữa (giữ ghép tiêu đề–ngày của `cvRows`/`structuredRows`).

Điểm mỗi fact (ổn định, tie → thứ tự gốc):

1. Liên kết `relevance` loại `source_passage_support`: trọng số theo `priority` yêu cầu (bắt buộc > ưu tiên) — bằng chứng CV Match. [dữ liệu XN; trọng số GT]
2. Khớp từ vựng với `jobSnapshot.skills` (bắt buộc) và `preferredSkills`, bằng cùng hàm khớp mục đã dùng cho Skills (`mentions`) — vì liên kết CV Match thưa (một quote mỗi component). [XN về độ thưa]
3. Không cộng điểm cho `ai_relevance_only`.

Chỉ đề xuất khi: thứ tự thay đổi **và** fact đứng đầu mới có điểm cao hơn rõ (ngưỡng, ví dụ ≥1 kỹ năng bắt buộc khác biệt). Lý do hiển thị được tạo xác định: "Khớp yêu cầu: Java, Spring Boot" (tên kỹ năng/yêu cầu khớp), không cần AI.

### 6.2 Dữ liệu (mở rộng tùy chọn, JSON trong `document`)

- `entry.orderProposal?: { factIds: string[]; reasons: Record<factId, string[]> }` — thứ tự đề xuất (hoán vị chỉ các fact thân bài của đoạn) và mã kỹ năng/yêu cầu khớp.
- `entry.originalFactIds?: string[]` — thứ tự gốc, ghi khi tạo draft (hoặc suy ra từ profile ghim cho draft cũ).
- `review.orders?: Record<entryId, 'accepted' | 'rejected'>` — quyết định người dùng.

### 6.3 Thao tác review (mở rộng hợp đồng tương thích ngược)

- `{ action: 'order', entryId, decision: 'accept' | 'reject' }` (chấp nhận đúng `orderProposal` đã lưu) và `{ action: 'order_restore', entryId }`.
- Backend: chấp nhận ⇒ hoán vị **chính `entry.facts`** theo `orderProposal` sau khi kiểm tra bất biến (mục 7); từ chối/khôi phục ⇒ thứ tự `originalFactIds`. Giống mọi thao tác review: tăng `revision`, xóa `approval`.
- (Tùy chọn sau) `{ action: 'order', entryId, factIds }` cho thứ tự do người dùng tự kéo-thả, cùng kiểm tra.

### 6.4 Vì sao áp vào `entry.facts`

Preview, preview cục bộ, `canonicalExport`, PDF (cả 3 template) và DOCX đều đọc `entry.facts` theo thứ tự → một thay đổi duy nhất ở backend đảm bảo nhất quán; renderer không đổi. Preview cục bộ (chưa lưu) cần áp thao tác `order` giống backend.

## 7. Mô hình duyệt và an toàn

Hành vi UI cần có (không triển khai):

- Bước "Tùy chỉnh & Rà soát": mỗi vai trò có đề xuất thứ tự hiển thị một thẻ "Thứ tự gợi ý" với danh sách gạch đầu dòng trước/sau và lý do ngắn ("Khớp yêu cầu: Java, Spring Boot"); nút **Áp dụng thứ tự**, **Giữ thứ tự gốc**; sau khi áp dụng có **Khôi phục thứ tự gốc**.
- Sửa câu chữ độc lập với thứ tự (thao tác `edit` hiện có không đổi vị trí).
- Preview "CV đã chỉnh sửa" phản ánh thứ tự đã áp dụng (cả khi chưa lưu); bước Duyệt & Xuất hiển thị PDF thật.
- Áp dụng/khôi phục thứ tự = thay đổi draft: tăng revision, **xóa duyệt**; export đòi duyệt lại. Không bao giờ thay đổi CV đã duyệt một cách âm thầm; đề xuất chỉ là dữ liệu cho tới khi người dùng chấp nhận.

Bất biến (✓ = kiểm tra xác định được trong `applyReview`):

- ✓ Thứ tự mới là **hoán vị** của tập fact thân bài cùng entry (cùng tập id, không thêm/bớt).
- ✓ Fact tiêu đề/ngày/nhà tuyển dụng/vai trò giữ nguyên vị trí; không di chuyển giữa entry hay section.
- ✓ Nội dung `acceptedText`, `factReviews`, `exportIncluded` không đổi khi đổi thứ tự.
- ✓ Thứ tự các entry (vai trò) và section không đổi → giữ trình tự thời gian.
- ✓ Luôn khôi phục được thứ tự gốc (`originalFactIds`).
- ✓ PDF và DOCX cùng thứ tự (cùng `canonicalExport`) — kiểm thử parity.
- ✓ Không có thao tác nào sinh văn bản mới → không thể bịa claim.
- Các bất biến về câu chữ (không bịa/không làm mạnh) do luồng gợi ý hiện có đảm nhiệm, không thay đổi.

## 8. Tác động dữ liệu / API / migration

| Thay đổi                  | Cần?          | Lý do                                                                     |
| ------------------------- | ------------- | ------------------------------------------------------------------------- |
| Migration DB              | **Không**     | Draft lưu JSONB; trường mới là tùy chọn                                   |
| Hợp đồng API              | Có, cộng thêm | Thao tác review mới; GET draft trả trường mới (client cũ bỏ qua)          |
| Schema tài liệu draft     | Có, tùy chọn  | `orderProposal`, `originalFactIds`, `review.orders`                       |
| Kiểm tra kích thước draft | Kiểm tra lại  | `DRAFT_BYTES`/131.072 byte: thêm vài trăm byte mỗi entry [GT]             |
| Preview                   | Có (web)      | Thẻ thứ tự + áp thao tác cục bộ khi chưa lưu; component preview không đổi |
| PDF / DOCX renderer       | **Không**     | Đọc `entry.facts` qua `canonicalExport`                                   |
| `decodeDraft` (web)       | Có            | Chấp nhận trường tùy chọn mới                                             |

Tương thích: draft cũ không có trường mới → không có đề xuất, thứ tự giữ nguyên (có thể tính đề xuất khi đọc mà không lưu, vì xếp hạng xác định — GT, cần quyết định). Draft đã duyệt: không bị ảnh hưởng cho tới khi người dùng áp dụng một thứ tự.

## 9. Nhất quán preview / PDF / DOCX

- Nguồn sự thật duy nhất: `entry.facts` sau khi áp quyết định. [XN rằng cả 3 đầu ra đọc nguồn này]
- Kiểm thử parity: cùng draft đã sắp xếp → thứ tự văn bản trong HTML preview, PDF (3 template, trích văn bản bằng pdfjs) và DOCX (mammoth) giống nhau.

## 10. Kiểm thử và tiêu chí chấp nhận

- Unit (xếp hạng): xác định, ổn định với hòa điểm, chỉ fact thân bài, không vượt đoạn tiêu đề/ngày, không đề xuất khi không cải thiện, lý do chỉ gồm kỹ năng có trong JD và fact.
- Unit (review): chấp nhận/từ chối/khôi phục; từ chối hoán vị không hợp lệ (thiếu/thừa id, id của entry khác, di chuyển fact tiêu đề); tăng revision, xóa duyệt; `factReviews` không đổi; sửa câu chữ sau khi sắp xếp giữ thứ tự.
- Integration: sinh draft (AI giả lập) → đề xuất thứ tự → chấp nhận → duyệt → export PDF/DOCX có thứ tự mới; draft cũ không có trường mới vẫn mở, duyệt, export như trước; draft đã duyệt không đổi khi chỉ đọc.
- Export regression: parity PDF/DOCX/HTML cho Classic/Modern/Compact; ghép tiêu đề–ngày không đổi.
- Web: thẻ thứ tự (sau khi có UI), preview cục bộ áp thao tác chưa lưu.
- Chấp nhận: với bộ java-backend (giả), ít nhất một vai trò có đề xuất đưa bullet Java/Spring Boot lên đầu; không đề xuất cho vai trò đã đúng thứ tự; 0 thay đổi văn bản; khôi phục trả lại đúng thứ tự gốc.

## 11. Rủi ro và rollback

- Fact thân bài xen giữa nhiều tiêu đề trong một entry (dự án con) → chỉ hoán vị trong đoạn; nếu cấu trúc lạ, không đề xuất. [GT về tần suất]
- Liên kết CV Match thưa → xếp hạng dựa nhiều vào khớp từ vựng; JD không nhắc tên công nghệ (ví dụ MyBatis) thì ít điểm.
- Thứ tự ổn định nhưng có thể không "đúng" theo đánh giá người dùng → luôn cần chấp nhận; không tự áp dụng.
- `sourceUpdate` ghép theo id: thứ tự draft không lan sang CV nguồn (mong muốn) — cần test xác nhận. [GT]
- Rollback: tắt việc sinh `orderProposal` (draft mới không có đề xuất); draft đã áp thứ tự vẫn hợp lệ vì chỉ là thứ tự `entry.facts`; người dùng khôi phục được bằng `order_restore`.

## 12. Các PR nhỏ đề xuất

1. **Xếp hạng thuần** (`experience-order.ts`): hàm xác định + unit test; chưa nối vào draft.
2. **Dữ liệu + review backend**: ghi `originalFactIds`/`orderProposal` khi sinh draft; thao tác `order` accept/reject/restore với kiểm tra bất biến; integration + export parity tests. Không UI.
3. **Web contract + preview cục bộ**: `decodeDraft` chấp nhận trường mới; áp thao tác `order` khi chưa lưu; test.
4. **UI thẻ "Thứ tự gợi ý"** (theo `docs/ux-guidelines.md`), smoke browser.
5. (Tùy chọn) tính đề xuất cho draft cũ khi đọc; (sau) thứ tự do người dùng kéo-thả; (sau) phương án B/C.

## 13. Quyết định cần phê duyệt

1. Chọn phương án A (sắp xếp trong vai trò) cho bản đầu.
2. Xếp hạng xác định không AI cho bản đầu (AI có thể bổ sung lý do sau, có kiểm tra).
3. Áp thứ tự trực tiếp vào `entry.facts` (renderer không đổi) thay vì lớp ánh xạ khi render.
4. Mở rộng hợp đồng: thao tác review `order` và các trường tùy chọn trong draft (không migration).
5. Draft cũ: không đề xuất, hay tính đề xuất khi đọc.
6. Thứ tự UI review: thẻ theo vai trò ở bước "Tùy chỉnh & Rà soát" — cần tham chiếu UX trước khi làm PR 4.
