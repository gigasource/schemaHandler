const Hooks = require("../hooks/hooks");
import { mount } from "@vue/test-utils";
import { ref, watchEffect, reactive, computed } from "vue";

//store:
function factory() {
  const order = new reactive({ items: [], takeAway: false });

  //ui logic
  const payBtnLabel = computed(() => {
    if (order.items.find(i => !i.sent)) return "print";
    if (order.items.length === 0) return "print";
    return "pay";
  });

  const payBtnClickable = computed(() => {
    if (order.items.length === 0) return false;
    return true;
  });

  return { order, payBtnLabel, payBtnClickable };
}

function hoc() {
  const hooks = new Hooks();
  const fn = () => ({
    props: ["msg"],
    setup({ msg }) {
      const { order, payBtnLabel, payBtnClickable } = factory();

      const _ref = ref("");
      watchEffect(() => {
        _ref.value = msg + " extend";
      });

      let payPrintBtnFn = () => {
        return (
          <p style={{ opacity: payBtnClickable ? 1 : 0.5 }}>
            {payBtnLabel.value}
          </p>
        );
      };

      hooks.emit("r:payPrintBtnFn", payPrintBtnFn, payBtnLabel, payBtnClickable, e => eval(e));

      return () => (
        <>
          {payPrintBtnFn()}
          <p></p>
        </>
      );
    }
  });
  return {
    hooks,
    fn
  };
}

describe("render", function() {
  it("case 1 test factory", function() {
    const { order, payBtnClickable, payBtnLabel } = factory();
    expect([payBtnLabel.value, payBtnClickable.value]).toMatchInlineSnapshot(`
      Array [
        "print",
        false,
      ]
    `);

    order.items.push({ name: "cola", sent: true });
    expect([payBtnLabel.value, payBtnClickable.value]).toMatchInlineSnapshot(`
      Array [
        "pay",
        true,
      ]
    `);
    order.items.push({ name: "fanta" });
    expect([payBtnLabel.value, payBtnClickable.value]).toMatchInlineSnapshot(`
      Array [
        "print",
        true,
      ]
    `);
  });

  it("case 2", async function() {
    const { fn, hooks } = hoc();
    hooks.on("r:payPrintBtnFn", function(
      payPrintBtnFn,
      payBtnLabel,
      payBtnClickable
    ) {
      this.update("payPrintBtnFn", () => (
        <button class={{ "btn-blur": !payBtnClickable.value }}>
          {payBtnLabel.value}
        </button>
      ));
    });

    const Component = fn();

    const wrapper = mount(Component, {
      props: {
        msg: "Hello world"
      }
    });

    expect(wrapper.html()).toMatchInlineSnapshot(
      `"<button class=\\"btn-blur\\">print</button><p></p>"`
    );
  });
});
