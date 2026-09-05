// Mobile nav toggle
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".main-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      nav.classList.toggle("is-open");
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => nav.classList.remove("is-open"));
    });
  }

  // FAQ accordion
  document.querySelectorAll(".faq-item").forEach((item) => {
    const question = item.querySelector(".faq-question");
    const answer = item.querySelector(".faq-answer");
    if (!question || !answer) return;

    question.addEventListener("click", () => {
      const isOpen = item.classList.contains("is-open");

      document.querySelectorAll(".faq-item.is-open").forEach((other) => {
        if (other !== item) {
          other.classList.remove("is-open");
          other.querySelector(".faq-answer").style.maxHeight = null;
        }
      });

      item.classList.toggle("is-open", !isOpen);
      answer.style.maxHeight = !isOpen ? `${answer.scrollHeight}px` : null;
    });
  });

  // Obfuscated mail links — address is assembled at click time so it
  // never appears as plain text in the page source (basic scraper defense).
  document.querySelectorAll("[data-mail-user]").forEach((el) => {
    const user = el.getAttribute("data-mail-user");
    const domain = el.getAttribute("data-mail-domain");
    const subject = el.getAttribute("data-mail-subject");
    const address = `${user}@${domain}`;

    el.addEventListener("click", (event) => {
      event.preventDefault();
      const params = subject ? `?subject=${encodeURIComponent(subject)}` : "";
      window.location.href = `mailto:${address}${params}`;
    });
  });
});
