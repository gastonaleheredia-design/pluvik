No, no debería mandarte al onboarding cada vez si ya lo completaste en el mismo navegador/dispositivo.

Lo que encontré:

1. **El onboarding no está ligado a tu cuenta.**
   Ahora se guarda solo en `localStorage` con la clave `pluvik-onboarding-complete`. Eso significa que si el preview cambia de dominio, el navegador limpia datos, usas otro dispositivo, modo privado, o el preview se recarga como entorno nuevo, la app “olvida” que ya viste el onboarding.

2. **Tu cuenta no depende del onboarding.**
   Crear/iniciar sesión usa el sistema de autenticación del backend. Tu cuenta no se borra porque aparezca el onboarding otra vez. El problema es más de experiencia/estado local, no de seguridad de la cuenta.

3. **El “stuck” o texto que a veces no aparece sí parece un bug real.**
   El onboarding usa varias clases visuales antiguas como `text-navy-deep`, `bg-navy-deep`, `text-parchment`, `bg-parchment`, pero el sistema de estilos actual define colores como `ink`, `paper`, `amber-brand`. Eso puede producir estados visuales inconsistentes, especialmente después de cambios recientes de diseño.

4. **También hay una carrera posible con auth/preview.**
   La app restaura la sesión de login de forma asíncrona. El home decide mostrar onboarding inmediatamente mirando solo `localStorage`, sin esperar a saber si hay usuario ni consultar un estado persistente del usuario.

Plan para arreglarlo sin cambiar el concepto visual:

1. **Separar “primera vez en este navegador” de “usuario ya onboarded”.**
   - Mantener `localStorage` como fallback rápido para usuarios anónimos.
   - Para usuarios logueados, guardar/leer un campo de onboarding en el perfil del usuario, por ejemplo `onboarding_completed_at`.
   - Así, si vuelves a entrar con tu cuenta, la app sabe que ya lo completaste aunque el preview/localStorage se haya limpiado.

2. **Evitar el redirect prematuro al onboarding.**
   - En la home, esperar a que auth termine de restaurarse antes de decidir si mandar al onboarding.
   - Si hay usuario y su onboarding está completo, ir directo al home.
   - Si no hay usuario, usar el estado local como hasta ahora.

3. **Hacer el onboarding visualmente estable.**
   - Reemplazar las clases antiguas por tokens existentes (`bg-paper`, `text-ink`, `text-amber-brand`, etc.) o estilos explícitos consistentes.
   - Mantener el diseño que te gusta, pero eliminar los casos donde el texto/botones pueden quedarse sin color correcto.

4. **Mejorar el flujo de login en preview.**
   - El modal ahora abre por defecto en “Create account”; podemos cambiarlo para que si el usuario ya tiene cuenta sea menos confuso, por ejemplo abriendo “Sign in” desde tracking/settings o mostrando ambos de forma más clara.

5. **Validación después del cambio.**
   - Probar: usuario anónimo nuevo → onboarding aparece.
   - Completar onboarding → no vuelve a aparecer en ese navegador.
   - Iniciar sesión → onboarding queda asociado a la cuenta.
   - Limpiar storage o entrar en otro preview → usuario logueado no vuelve a onboarding si ya lo completó.
   - Revisar mobile 430px para confirmar que textos y botones no desaparecen ni se superponen.