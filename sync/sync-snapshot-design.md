### Sync snapshot doc

- Dựa trên tính chất của máy phụ là không cần quan tâm đến chi tiết của commit (chỉ cần quan tâm đến highestCommitId), lấy uuid của commit cao nhất ở thời điểm hiện tại của máy chính để kiểm tra xem máy phụ sync hết chưa.

- Máy chính phải lưu lại thời điểm sync là khi nào, để khi bị ngắt giữa chừng phải tính toán được thời điểm bắt đầu sync để ghi vào commit để máy phụ còn biết.

- phải block toàn bộ transporter trên master khi sync (vẫn nhận commit nhưng không gửi commit đi)

- Sync snapshot luôn phải chạy trước khi init bất cứ 1 transporter nào
