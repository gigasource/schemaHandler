1. bài toán đưa ra là: làm sao để code chạy trên n môi trường khác nhau 

```javascript

//context base: -> script thi se dung socket nao !!!
//not really good as flow design

//makeFlowFunction
const printToKitchen = makeFlowFunction(PrintToKitchen);

//system will provide uuid for this function, will use this function on all environment
//magic ở đây là base trên uuid để lấy ra đc các biến cần thiết
async function PrintToKitchen() {
  const {emitMaster, onMaster} = useConnect();
  //if use compiler -> easy for removing this code
  const [step1, step2, stepPrint] = useStep('client-frontend', 'master', 'print-node');
  const {registerTse, } = useContext();
  
  step1(async () => {
    assignDate();
    await stepPrint(order);
    saveOrder();
    await step2(order);
    //garanntie all data is here
  });

  stepPrint(async function (order) {
    print(order);
  })
  
  step2(async function (order) {
    registerTse(order);
    this.setValue(order);
  })
}
```

2.Redesign all of system
