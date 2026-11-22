import React, {useEffect,useRef,useState} from 'react';

interface ScrollJumpControlsProps {
  scopeRef:React.RefObject<HTMLElement|null>;
  refreshKey:string;
}
type Position={up:boolean;down:boolean};
const EMPTY:Position={up:false,down:false};

/** Navigation for the last interacted scroll region. All scrolling stays native:
 * wheel, touchpad, touch, PgUp/PgDn, Home/End and keyboard focus still work.
 * The dock does not own scrolling and never intercepts the main content.
 */
export function ScrollJumpControls({scopeRef,refreshKey}:ScrollJumpControlsProps):React.JSX.Element {
  const [position,setPosition]=useState<Position>(EMPTY);
  const target=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const scope=scopeRef.current;
    if(!scope)return;
    let frame=0;
    const scrollable=(element:HTMLElement):boolean=>{
      const overflow=getComputedStyle(element).overflowY;
      return (overflow==='auto'||overflow==='scroll')&&
        element.scrollHeight>element.clientHeight+3;
    };
    const fallback=():HTMLElement|null=>{
      const view=scope.querySelector<HTMLElement>('.view');
      if(view&&scrollable(view))return view;
      for(const node of scope.querySelectorAll<HTMLElement>(
        '.console,.history-list,.saved-log,.simulation-scroll,.view,.modal')){
        if(scrollable(node))return node;
      }
      return null;
    };
    const refresh=()=>{
      frame=0;
      const current=target.current;
      if(!current||!current.isConnected||!scope.contains(current)||
        !scrollable(current))target.current=fallback();
      const element=target.current;
      const next=element?{
        up:element.scrollTop>3,
        down:element.scrollTop+element.clientHeight<element.scrollHeight-3,
      }:EMPTY;
      setPosition(previous=>previous.up===next.up&&previous.down===next.down
        ?previous:next);
    };
    const schedule=()=>{
      if(!frame)frame=requestAnimationFrame(refresh);
    };
    const onScroll=(event:Event)=>{
      const element=event.target;
      if(element instanceof HTMLElement&&scope.contains(element)&&scrollable(element)){
        target.current=element;
        schedule();
      }
    };
    const onPointer=(event:Event)=>{
      const start=event.target;
      if(!(start instanceof HTMLElement))return;
      let node:HTMLElement|null=start;
      while(node&&node!==scope){
        if(scrollable(node)){
          if(target.current!==node){target.current=node;schedule();}
          return;
        }
        node=node.parentElement;
      }
    };
    const observer=new MutationObserver(schedule);
    observer.observe(scope,{subtree:true,childList:true,characterData:false});
    scope.addEventListener('scroll',onScroll,true);
    scope.addEventListener('pointerover',onPointer,true);
    window.addEventListener('resize',schedule);
    const view=scope.querySelector<HTMLElement>('.view');
    const resize=new ResizeObserver(schedule);
    resize.observe(scope);
    if(view)resize.observe(view);
    target.current=fallback();
    refresh();
    return ()=>{
      observer.disconnect();resize.disconnect();
      scope.removeEventListener('scroll',onScroll,true);
      scope.removeEventListener('pointerover',onPointer,true);
      window.removeEventListener('resize',schedule);
      if(frame)cancelAnimationFrame(frame);
      target.current=null;
    };
  },[scopeRef,refreshKey]);
  const jump=(where:'up'|'down')=>{
    const element=target.current;
    if(!element||!element.isConnected)return;
    element.scrollTo({
      top:where==='up'?0:element.scrollHeight,
      behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ?'instant':'smooth',
    });
  };
  return <nav className="scroll-jump-controls" aria-label="Scrollnavigation">
    {position.up&&<button type="button" onClick={()=>jump('up')}
      title="Zum Anfang springen" aria-label="Zum Anfang springen">↑</button>}
    {position.down&&<button type="button" onClick={()=>jump('down')}
      title="Zum Ende springen" aria-label="Zum Ende springen">↓</button>}
  </nav>;
}
