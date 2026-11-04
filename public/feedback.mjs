// Transient feedback belongs to the current screen, never a persistent action.
export function createFeedback(node, {schedule=setTimeout,cancel=clearTimeout,duration=5000}={}) {
  let timer=null;
  function clear(){if(timer!==null)cancel(timer);timer=null;node.textContent='';node.classList.remove('error');}
  function show(message,error=false){clear();node.textContent=message;node.classList.toggle('error',error);timer=schedule(clear,duration);}
  return {show,clear};
}
