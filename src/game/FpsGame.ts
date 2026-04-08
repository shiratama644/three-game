import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Scalar, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture'
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock'

export interface GameInput {
  moveX: number
  moveY: number
  lookX: number
  lookY: number
  jump: boolean
  slide: boolean
}

type InputReader = () => GameInput

const PLAYER_HEIGHT = 1.8
const PLAYER_RADIUS = 0.3

export class FpsGame {
  private readonly canvas: HTMLCanvasElement
  private readonly readInput: InputReader
  private readonly onLoadingChange: (loading: boolean) => void
  private engine: Engine | null = null
  private scene: Scene | null = null
  private camera: UniversalCamera | null = null
  private player: Mesh | null = null
  private ground: Mesh | null = null
  private labelPlane: Mesh | null = null
  private labelTexture: AdvancedDynamicTexture | null = null
  private groundMaterial: StandardMaterial | null = null
  private playerMaterial: StandardMaterial | null = null
  private light: HemisphericLight | null = null
  private velocity = Vector3.Zero()
  private yaw = 0
  private pitch = 0
  private isGrounded = true
  private isSliding = false
  private slideRemaining = 0
  private isRendering = false
  private readonly visibilityHandler = () => {
    if (document.hidden) {
      this.stopRenderLoop()
      return
    }
    this.startRenderLoop()
  }

  constructor(
    canvas: HTMLCanvasElement,
    readInput: InputReader,
    onLoadingChange: (loading: boolean) => void,
  ) {
    this.canvas = canvas
    this.readInput = readInput
    this.onLoadingChange = onLoadingChange
  }

  async initialize(): Promise<void> {
    this.onLoadingChange(true)

    const engine = new Engine(this.canvas, true, {
      preserveDrawingBuffer: false,
      stencil: false,
      antialias: false,
    })
    engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 2))

    const scene = new Scene(engine)
    scene.useRightHandedSystem = true
    scene.autoClear = true

    const camera = new UniversalCamera('fps-camera', new Vector3(0, 1.6, 0), scene)
    camera.minZ = 0.1
    camera.fov = 1.05
    camera.inputs.clear()
    scene.activeCamera = camera

    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
    light.intensity = 0.95

    const ground = MeshBuilder.CreateGround(
      'ground',
      {
        width: 150,
        height: 150,
        subdivisions: 1,
      },
      scene,
    )
    const groundMaterial = new StandardMaterial('ground-mat', scene)
    groundMaterial.diffuseColor = new Color3(0.2, 0.55, 0.22)
    groundMaterial.specularColor = Color3.Black()
    ground.material = groundMaterial

    const player = MeshBuilder.CreateCapsule(
      'player',
      {
        height: PLAYER_HEIGHT,
        radius: PLAYER_RADIUS,
        tessellation: 6,
      },
      scene,
    )
    player.position.y = PLAYER_HEIGHT / 2
    const playerMaterial = new StandardMaterial('player-mat', scene)
    playerMaterial.diffuseColor = new Color3(0.82, 0.85, 0.95)
    playerMaterial.specularColor = Color3.Black()
    player.material = playerMaterial

    camera.parent = player
    camera.position = new Vector3(0, 1.6, 0)

    const labelPlane = MeshBuilder.CreatePlane(
      'player-label-plane',
      { size: 0.6 },
      scene,
    )
    labelPlane.parent = player
    labelPlane.position = new Vector3(0, 1.4, 0)
    labelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL
    const labelTexture = AdvancedDynamicTexture.CreateForMesh(labelPlane, 256, 128, false)
    const text = new TextBlock('player-label', 'PLAYER')
    text.color = 'white'
    text.fontSize = 42
    labelTexture.addControl(text)

    this.engine = engine
    this.scene = scene
    this.camera = camera
    this.player = player
    this.ground = ground
    this.labelPlane = labelPlane
    this.labelTexture = labelTexture
    this.groundMaterial = groundMaterial
    this.playerMaterial = playerMaterial
    this.light = light

    window.addEventListener('resize', this.handleResize)
    document.addEventListener('visibilitychange', this.visibilityHandler)

    await scene.whenReadyAsync()
    this.onLoadingChange(false)
    this.startRenderLoop()
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.visibilityHandler)
    window.removeEventListener('resize', this.handleResize)

    this.stopRenderLoop()

    this.labelTexture?.dispose()
    this.labelTexture = null

    this.labelPlane?.dispose(false, false)
    this.labelPlane = null

    this.player?.dispose(false, false)
    this.player = null

    this.ground?.dispose(false, false)
    this.ground = null

    this.groundMaterial?.dispose()
    this.groundMaterial = null

    this.playerMaterial?.dispose()
    this.playerMaterial = null

    this.light?.dispose()
    this.light = null

    this.scene?.dispose()
    this.scene = null
    this.camera = null

    this.engine?.dispose()
    this.engine = null
  }

  private readonly handleResize = () => {
    this.engine?.resize()
  }

  private startRenderLoop(): void {
    if (!this.engine || !this.scene || this.isRendering) {
      return
    }
    this.isRendering = true
    this.engine.runRenderLoop(() => {
      if (!this.engine || !this.scene) {
        return
      }
      const dt = this.engine.getDeltaTime() / 1000
      this.update(dt)
      this.scene.render()
    })
  }

  private stopRenderLoop(): void {
    if (!this.engine || !this.isRendering) {
      return
    }
    this.engine.stopRenderLoop()
    this.isRendering = false
  }

  private update(deltaSec: number): void {
    if (!this.player || !this.camera) {
      return
    }

    const dt = Math.min(0.033, Math.max(0.001, deltaSec))
    const input = this.readInput()

    const lookSensitivity = 0.003
    this.yaw += input.lookX * lookSensitivity
    this.pitch = Scalar.Clamp(
      this.pitch + input.lookY * lookSensitivity,
      -Math.PI * 0.45,
      Math.PI * 0.45,
    )

    this.player.rotationQuaternion = null
    this.player.rotation.y = this.yaw
    this.camera.rotation = new Vector3(this.pitch, 0, 0)

    const moveInput = new Vector3(input.moveX, 0, input.moveY)
    if (moveInput.lengthSquared() > 1) {
      moveInput.normalize()
    }

    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    const desired = right.scale(moveInput.x).add(forward.scale(moveInput.z))

    const isMoving = desired.lengthSquared() > 0.001
    const walkingSpeed = 4
    const slidingSpeed = 8

    if (input.slide && this.isGrounded && isMoving && !this.isSliding) {
      this.isSliding = true
      this.slideRemaining = 0.6
    }
    if (this.isSliding) {
      this.slideRemaining -= dt
      if (this.slideRemaining <= 0) {
        this.isSliding = false
      }
    }

    const targetSpeed = this.isSliding ? slidingSpeed : walkingSpeed
    const targetVelocity = desired.scale(targetSpeed)
    const smoothing = this.isGrounded ? 22 : 8
    const blend = Scalar.Clamp(smoothing * dt, 0, 1)

    this.velocity.x = Scalar.Lerp(this.velocity.x, targetVelocity.x, blend)
    this.velocity.z = Scalar.Lerp(this.velocity.z, targetVelocity.z, blend)

    if (input.jump && this.isGrounded) {
      this.velocity.y = 7.8
      this.isGrounded = false
      this.isSliding = false
    }

    this.velocity.y -= 23 * dt

    const nextPosition = this.player.position.add(this.velocity.scale(dt))
    const minY = PLAYER_HEIGHT / 2
    if (nextPosition.y <= minY) {
      nextPosition.y = minY
      this.velocity.y = 0
      this.isGrounded = true
    }
    this.player.position.copyFrom(nextPosition)

    const standingEye = 1.6
    const slidingEye = 1.15
    const targetEye = this.isSliding ? slidingEye : standingEye
    const eyeBlend = Scalar.Clamp(10 * dt, 0, 1)
    this.camera.position.y = Scalar.Lerp(this.camera.position.y, targetEye, eyeBlend)
  }
}
