/**
 * WhatsApp Click to Chat cannot report whether the customer pressed Send.
 * Keep this endpoint disabled instead of presenting a backend receipt.
 */
export async function POST() {
  return Response.json(
    {
      error: {
        code: "WHATSAPP_HANDOFF_ONLY",
        message: "يجب على العميلة إرسال الطلب يدويًا من نافذة واتساب. لا يستقبل هذا المسار الطلبات.",
      },
    },
    { status: 410 },
  );
}
